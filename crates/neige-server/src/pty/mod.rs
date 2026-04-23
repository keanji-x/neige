//! Per-session connection to a `neige-session-daemon`.
//!
//! This module used to spawn a local PTY that ran `tmux attach-session`; now
//! the PTY lives in the daemon and we only hold a Unix-socket client to it.
//! The broadcast/history/seq logic is unchanged — it still exists here so
//! the WS handler's reconnect/replay protocol (seq=0 snapshot, delta replay)
//! keeps working on top of the same `AttachResult`.

use std::collections::VecDeque;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tokio::net::UnixStream;
use tokio::sync::{broadcast, mpsc};
use tracing::debug;
use uuid::Uuid;

use neige_session::{ClientMsg, DaemonMsg, read_frame, write_frame};

/// Rolling byte-chunk history, each chunk tagged with a monotonically
/// increasing sequence number. Lets a reconnecting client request "everything
/// since seq N" so it doesn't re-render content its xterm already has.
///
/// When the byte budget is exceeded we evict whole chunks from the front —
/// each chunk is a single DaemonMsg::Stdout frame, so granularity is fine.
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
        self.next_seq.saturating_sub(1)
    }

    fn since(&self, after_seq: u64) -> Vec<(u64, Vec<u8>)> {
        self.chunks
            .iter()
            .filter(|(s, _)| *s > after_seq)
            .cloned()
            .collect()
    }

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
    UpToDate {
        latest_seq: u64,
    },
    Delta {
        chunks: Vec<(u64, Vec<u8>)>,
        latest_seq: u64,
    },
    Snapshot {
        bytes: Vec<u8>,
        latest_seq: u64,
    },
}

/// Writer handed to WS inbound code. Internally queues every `write_all`
/// as a `ClientMsg::Stdin` frame on the daemon socket. We expose the old
/// `Write + Send` shape so call sites don't have to change.
struct FramedWriter {
    tx: mpsc::UnboundedSender<ClientMsg>,
}

impl Write for FramedWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.tx
            .send(ClientMsg::Stdin(buf.to_vec()))
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "daemon gone"))?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// A session backed by a `neige-session-daemon` over a Unix socket.
pub struct PtySession {
    /// Control channel to the daemon (Stdin / Resize / Kill frames). Writes
    /// happen on a tokio task that owns the socket's write half.
    ctrl_tx: mpsc::UnboundedSender<ClientMsg>,
    /// Live-broadcast: every DaemonMsg::Stdout byte gets a seq and fans out.
    /// Send happens under the history lock so `attach()` sees a coherent view.
    pub tx: broadcast::Sender<(u64, Vec<u8>)>,
    history: Arc<Mutex<History>>,
    /// Flipped to false by the reader task when the daemon socket closes
    /// (child exit / daemon crash).
    alive: Arc<std::sync::atomic::AtomicBool>,
    #[allow(dead_code)]
    sock_path: PathBuf,
}

impl PtySession {
    /// Connect to the daemon for `id` and send the initial Attach. Spawns
    /// tasks that keep the socket plumbed: reader (socket → history +
    /// broadcast), writer (mpsc → socket), both tied to `alive`.
    pub async fn connect(id: &Uuid, cols: u16, rows: u16) -> Result<Self, String> {
        let sock_path = crate::session::sock_path(id);
        let stream = UnixStream::connect(&sock_path)
            .await
            .map_err(|e| format!("connect daemon socket {sock_path:?}: {e}"))?;
        let (mut rd, mut wr) = stream.into_split();

        // Attach handshake — daemon responds with Hello{replay}.
        write_frame(&mut wr, &ClientMsg::Attach { cols, rows })
            .await
            .map_err(|e| format!("send Attach: {e}"))?;
        let first: DaemonMsg = read_frame(&mut rd)
            .await
            .map_err(|e| format!("read Hello: {e}"))?;
        let replay = match first {
            DaemonMsg::Hello { replay } => replay,
            other => return Err(format!("expected Hello, got {other:?}")),
        };

        let history = Arc::new(Mutex::new(History::new(HISTORY_MAX_BYTES)));
        let (tx, _) = broadcast::channel::<(u64, Vec<u8>)>(256);
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));

        // Seed history with the replay so a WS client that attaches after us
        // can be primed from Snapshot (not wait for the first live byte).
        if !replay.is_empty() {
            if let Ok(mut h) = history.lock() {
                let seq = h.append(replay.clone());
                let _ = tx.send((seq, replay));
            }
        }

        // Reader: socket → (history + broadcast). Holds history lock while
        // broadcasting so attach() sees a consistent seq.
        let history_r = history.clone();
        let tx_r = tx.clone();
        let alive_r = alive.clone();
        tokio::spawn(async move {
            let mut rd = rd;
            loop {
                let msg: DaemonMsg = match read_frame(&mut rd).await {
                    Ok(m) => m,
                    Err(_) => break,
                };
                match msg {
                    DaemonMsg::Stdout(bytes) => {
                        if let Ok(mut h) = history_r.lock() {
                            let seq = h.append(bytes.clone());
                            let _ = tx_r.send((seq, bytes));
                        }
                    }
                    DaemonMsg::ChildExited { code } => {
                        tracing::info!(?code, "daemon reported child exit");
                        break;
                    }
                    // A second Hello would only arrive if we re-attached;
                    // we don't, so treat as noise.
                    DaemonMsg::Hello { .. } => {}
                }
            }
            alive_r.store(false, std::sync::atomic::Ordering::Relaxed);
        });

        // Writer: mpsc → socket. Buffering and flushing are handled frame-
        // by-frame inside write_frame.
        let (ctrl_tx, mut ctrl_rx) = mpsc::unbounded_channel::<ClientMsg>();
        let alive_w = alive.clone();
        tokio::spawn(async move {
            while let Some(msg) = ctrl_rx.recv().await {
                if write_frame(&mut wr, &msg).await.is_err() {
                    break;
                }
            }
            alive_w.store(false, std::sync::atomic::Ordering::Relaxed);
        });

        debug!("daemon attached: sock={sock_path:?}");

        Ok(Self {
            ctrl_tx,
            tx,
            history,
            alive,
            sock_path,
        })
    }

    /// Return a cloneable, `Write`-implementing handle the WS inbound path
    /// can drop bytes into. Writes become ClientMsg::Stdin frames.
    pub fn writer_handle(&self) -> Arc<Mutex<Box<dyn Write + Send>>> {
        let writer: Box<dyn Write + Send> = Box::new(FramedWriter {
            tx: self.ctrl_tx.clone(),
        });
        Arc::new(Mutex::new(writer))
    }

    /// Forward a resize to the daemon (last-wins at the daemon side).
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.ctrl_tx
            .send(ClientMsg::Resize { cols, rows })
            .map_err(|_| "daemon channel closed".to_string())
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Atomically subscribe to live output and prepare the catch-up payload
    /// for a (re)attaching WS client. Holding the history lock across both
    /// the snapshot and the subscribe blocks the socket reader — any chunk
    /// it appends after we release will carry a strictly-greater seq and
    /// be delivered to the returned receiver without loss.
    pub fn attach(
        &self,
        last_seq: Option<u64>,
    ) -> (broadcast::Receiver<(u64, Vec<u8>)>, AttachResult) {
        let history = self.history.lock().expect("history poisoned");
        let rx = self.tx.subscribe();
        let latest = history.latest_seq();
        let earliest = history.earliest_seq();

        let result = match (last_seq, earliest) {
            (Some(ls), _) if ls >= latest => AttachResult::UpToDate { latest_seq: latest },
            (Some(ls), Some(earliest_seq)) if ls >= earliest_seq.saturating_sub(1) => {
                AttachResult::Delta {
                    chunks: history.since(ls),
                    latest_seq: latest,
                }
            }
            _ => AttachResult::Snapshot {
                bytes: history.full_snapshot(),
                latest_seq: latest,
            },
        };

        (rx, result)
    }
}

// No explicit Drop — we deliberately do NOT kill the daemon when the
// PtySession is dropped. Daemons must survive neige-server restarts; the
// explicit lifecycle is `session::kill_session` called from the conversation
// manager's `remove()`.
