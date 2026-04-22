use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tracing::debug;

/// Rolling byte-chunk history, each chunk tagged with a monotonically
/// increasing sequence number. Lets a reconnecting client request "everything
/// since seq N" so it doesn't re-render content its xterm already has.
///
/// When the byte budget is exceeded we evict whole chunks from the front —
/// each chunk is at most 4 KiB (PTY read size), so granularity is fine enough.
const HISTORY_MAX_BYTES: usize = 2 * 1024 * 1024;

struct History {
    chunks: VecDeque<(u64, Vec<u8>)>,
    total_bytes: usize,
    max_bytes: usize,
    next_seq: u64,
}

impl History {
    fn new(max_bytes: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            total_bytes: 0,
            max_bytes,
            // Start at 1 so seq=0 stays reserved as a "snapshot / reset"
            // marker on the wire. See `AttachResult::Snapshot`.
            next_seq: 1,
        }
    }

    fn append(&mut self, bytes: Vec<u8>) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.total_bytes += bytes.len();
        self.chunks.push_back((seq, bytes));
        // Evict oldest chunks until we fit budget. Keep at least one so
        // `latest_seq()` stays meaningful immediately after a big write.
        while self.total_bytes > self.max_bytes && self.chunks.len() > 1 {
            let (_, dropped) = self.chunks.pop_front().unwrap();
            self.total_bytes -= dropped.len();
        }
        seq
    }

    fn earliest_seq(&self) -> Option<u64> {
        self.chunks.front().map(|(s, _)| *s)
    }

    fn latest_seq(&self) -> u64 {
        // `next_seq` is always 1 + the highest appended seq (or 1 if never
        // appended — we haven't emitted anything, so "latest" is 0).
        self.next_seq.saturating_sub(1)
    }

    /// Chunks strictly after `after_seq`, in order.
    fn since(&self, after_seq: u64) -> Vec<(u64, Vec<u8>)> {
        self.chunks
            .iter()
            .filter(|(s, _)| *s > after_seq)
            .cloned()
            .collect()
    }

    /// Flatten every chunk we still have into a single byte vector. Used
    /// when a client is too far behind for a delta replay and we instead
    /// send a reset + full redraw of whatever the buffer still contains.
    fn full_snapshot(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.total_bytes);
        for (_, bytes) in &self.chunks {
            out.extend_from_slice(bytes);
        }
        out
    }
}

/// Result of `PtySession::attach` — tells the WS handler how to prime a new
/// connection before it starts forwarding the live broadcast.
pub enum AttachResult {
    /// Client is caught up; nothing to send before live output.
    UpToDate { latest_seq: u64 },
    /// Client's `last_seq` is still in the ring; replay just the tail.
    Delta {
        chunks: Vec<(u64, Vec<u8>)>,
        latest_seq: u64,
    },
    /// Client missed too much (or is fresh); send a clear + full redraw.
    /// `latest_seq` is what the client should record as its new baseline.
    Snapshot { bytes: Vec<u8>, latest_seq: u64 },
}

/// A session backed by a real PTY — streams raw escape sequences.
pub struct PtySession {
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    /// Live-broadcast channel. Each message is (seq, bytes) matching what was
    /// just appended to `history` — send happens under the same lock so an
    /// `attach()` holding that lock sees a coherent view.
    pub tx: broadcast::Sender<(u64, Vec<u8>)>,
    history: Arc<Mutex<History>>,
    _reader_handle: Option<std::thread::JoinHandle<()>>,
}

impl PtySession {
    /// Spawn `program` in a new PTY with the given working directory.
    pub fn spawn(
        program: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        env: &[(String, String)],
    ) -> Result<Self, String> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg(program);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for (k, v) in env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed: {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take_writer failed: {e}"))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone_reader failed: {e}"))?;

        let (tx, _) = broadcast::channel::<(u64, Vec<u8>)>(256);
        let tx_clone = tx.clone();
        let history = Arc::new(Mutex::new(History::new(HISTORY_MAX_BYTES)));
        let history_clone = history.clone();

        // Reader thread: read PTY → { assign seq + append to history + broadcast }
        // all under the history lock. That lock order is what makes `attach()`
        // race-free — see the comment there.
        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        if let Ok(mut h) = history_clone.lock() {
                            let seq = h.append(chunk.clone());
                            let _ = tx_clone.send((seq, chunk));
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        debug!("PTY session spawned: {program}");

        Ok(Self {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
            tx,
            history,
            _reader_handle: Some(handle),
        })
    }

    /// Get a clone of the writer Arc for direct PTY writes without holding the manager lock.
    pub fn writer_handle(&self) -> Arc<Mutex<Box<dyn Write + Send>>> {
        self.writer.clone()
    }

    /// Resize the PTY.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.lock().map_err(|e| format!("lock: {e}"))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize: {e}"))?;
        Ok(())
    }

    /// Check if the child process is still running.
    pub fn is_alive(&self) -> bool {
        let mut child = match self.child.lock() {
            Ok(c) => c,
            Err(_) => return false,
        };
        matches!(child.try_wait(), Ok(None))
    }

    /// Atomically subscribe to live output and prepare the catch-up payload
    /// for a (re)attaching client. Holding the history lock across both the
    /// snapshot and the subscribe is what keeps the reader thread blocked —
    /// so any chunk it writes after we release the lock will (a) carry a seq
    /// strictly greater than everything we captured, and (b) be delivered to
    /// us via the returned receiver without loss or duplication.
    pub fn attach(
        &self,
        last_seq: Option<u64>,
    ) -> (broadcast::Receiver<(u64, Vec<u8>)>, AttachResult) {
        let history = self.history.lock().expect("history poisoned");
        let rx = self.tx.subscribe();
        let latest = history.latest_seq();
        let earliest = history.earliest_seq();

        let result = match (last_seq, earliest) {
            // Client is up to date (or ahead, which shouldn't happen normally).
            (Some(ls), _) if ls >= latest => AttachResult::UpToDate { latest_seq: latest },
            // Client's baseline is still in the buffer → delta replay.
            (Some(ls), Some(earliest_seq)) if ls >= earliest_seq.saturating_sub(1) => {
                AttachResult::Delta {
                    chunks: history.since(ls),
                    latest_seq: latest,
                }
            }
            // Fresh attach OR buffer evicted past client's last_seq → snapshot.
            _ => AttachResult::Snapshot {
                bytes: history.full_snapshot(),
                latest_seq: latest,
            },
        };

        (rx, result)
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}
