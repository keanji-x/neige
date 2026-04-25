//! neige-session-daemon — per-session PTY supervisor.
//!
//! Spawns the user's program under a PTY, broadcasts raw PTY output to every
//! attached client, and keeps a small ring buffer of recent bytes so a
//! freshly-(re)attaching client can replay them. Survives all client
//! disconnects; exits when the child does.
//!
//! Architecture: the daemon does NO terminal-state parsing. It is a pure
//! byte pump. Cursor / scrollback / cell-grid interpretation lives on the
//! client side (xterm.js). This trades a slightly larger reattach payload
//! (~1 MiB instead of a single-screen snapshot) for never having a
//! server-side vt100 parser to maintain or hit edge cases on. See discussion
//! in commit history for the trade-off rationale.

use std::collections::VecDeque;
use std::io::Write as _;
use std::os::unix::io::FromRawFd;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use clap::Parser;
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, mpsc, oneshot};
use uuid::Uuid;

use neige_session::{ClientMsg, DaemonMsg, read_frame, write_frame};

#[derive(Parser, Debug)]
#[command(name = "neige-session-daemon", about = "Per-session PTY supervisor for neige")]
struct Cli {
    /// Session ID. Used for logging and (by convention) socket path.
    #[arg(long)]
    id: Uuid,

    /// Unix socket path to listen on. Parent directory is created if missing.
    #[arg(long)]
    sock: PathBuf,

    /// Replay buffer size in bytes — the rolling window of recent PTY output
    /// kept so a fresh attach can repaint the screen. Default 1 MiB is enough
    /// to cover several screenfuls of typical agent CLI output.
    #[arg(long, default_value_t = 1024 * 1024)]
    buffer_bytes: usize,

    /// Initial PTY columns. First Attach resizes to the real client size.
    #[arg(long, default_value_t = 80)]
    cols: u16,

    /// Initial PTY rows. Same caveat as --cols.
    #[arg(long, default_value_t = 24)]
    rows: u16,

    /// Working directory for the spawned child. Defaults to the daemon's cwd.
    #[arg(long)]
    cwd: Option<PathBuf>,

    /// File descriptor to write "ready\n" to after the socket is bound.
    /// The parent passes an open pipe fd here so it can block until we're
    /// accepting connections without racing to stat(2) the socket path.
    #[arg(long)]
    ready_fd: Option<i32>,

    /// Program and args to run under the PTY. Use `--` to separate.
    #[arg(last = true, required = true)]
    cmd: Vec<String>,
}

/// Events fanned out to every attached client.
#[derive(Clone, Debug)]
enum Event {
    Output(Vec<u8>),
    Exit(Option<i32>),
}

/// Rolling byte ring used to seed the Hello replay for a new client.
///
/// Stored as a deque of chunks (each = one PTY read) so eviction is
/// chunk-granular — we never split an escape sequence. When `total_bytes`
/// exceeds `max_bytes` we drop chunks from the front, which can lose
/// older context but keeps memory bounded.
struct ByteBuffer {
    chunks: VecDeque<Vec<u8>>,
    total_bytes: usize,
    max_bytes: usize,
}

impl ByteBuffer {
    fn new(max_bytes: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            total_bytes: 0,
            max_bytes,
        }
    }

    fn append(&mut self, bytes: Vec<u8>) {
        self.total_bytes += bytes.len();
        self.chunks.push_back(bytes);
        while self.total_bytes > self.max_bytes && self.chunks.len() > 1 {
            let dropped = self.chunks.pop_front().unwrap();
            self.total_bytes -= dropped.len();
        }
    }

    /// Concatenated copy of the current buffer — fed straight into the
    /// `DaemonMsg::Hello { replay }` field. Cheap clone-out is fine here:
    /// only happens on attach, not in the hot path.
    fn snapshot(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.total_bytes);
        for c in &self.chunks {
            out.extend_from_slice(c);
        }
        out
    }
}

type SharedBuffer = Arc<Mutex<ByteBuffer>>;
type SharedMaster = Arc<Mutex<Box<dyn MasterPty + Send>>>;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    tracing::info!(id = %cli.id, cmd = ?cli.cmd, "starting daemon");

    // ---- PTY + child ----
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: cli.rows,
        cols: cli.cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;
    let mut cmd = CommandBuilder::new(&cli.cmd[0]);
    for a in &cli.cmd[1..] {
        cmd.arg(a);
    }
    if let Some(cwd) = &cli.cwd {
        cmd.cwd(cwd);
    }
    // Forward every env var we have to the child. The caller (neige-server)
    // sets the env it wants (TERM, COLORTERM, proxy vars, ...) when it spawns
    // us, and the child should see the same environment.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    let child = pair.slave.spawn_command(cmd)?;
    // Split out a separately-owned killer before the child moves into the
    // waiter task. A ClientMsg::Kill handler calls through this.
    let killer: Arc<Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>> =
        Arc::new(Mutex::new(child.clone_killer()));
    drop(pair.slave);

    let buffer: SharedBuffer = Arc::new(Mutex::new(ByteBuffer::new(cli.buffer_bytes)));
    let master: SharedMaster = Arc::new(Mutex::new(pair.master));
    let (event_tx, _) = broadcast::channel::<Event>(2048);
    let (stdin_tx, stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // ---- PTY reader → buffer + broadcast ----
    let reader = master.lock().unwrap().try_clone_reader()?;
    spawn_pty_reader(reader, buffer.clone(), event_tx.clone());

    // ---- PTY writer ← client stdin ----
    let writer = master.lock().unwrap().take_writer()?;
    spawn_pty_writer(writer, stdin_rx);

    // ---- Child-exit watcher ----
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    spawn_child_waiter(child, event_tx.clone(), shutdown_tx);

    // ---- Socket ----
    if let Some(parent) = cli.sock.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    if cli.sock.exists() {
        // A stale socket from a previous run — safe to remove because no one
        // else owns this id (caller guarantees uniqueness).
        std::fs::remove_file(&cli.sock)?;
    }
    let listener = UnixListener::bind(&cli.sock)?;
    tracing::info!(sock = %cli.sock.display(), "listening");

    // Tell the parent we're accepting — lets it avoid racing to connect.
    if let Some(fd) = cli.ready_fd {
        // SAFETY: fd is owned by us (parent passed it via fork/exec), it's a
        // writable pipe, and we take exclusive ownership here by not using it
        // anywhere else in the process.
        let mut f = unsafe { std::fs::File::from_raw_fd(fd) };
        let _ = f.write_all(b"ready\n");
        drop(f);
    }

    // ---- Accept loop ----
    let accept_task = tokio::spawn(accept_loop(
        listener,
        event_tx.clone(),
        buffer.clone(),
        master.clone(),
        stdin_tx.clone(),
        killer.clone(),
    ));

    // Block until the child exits.
    let _ = shutdown_rx.await;
    tracing::info!("child exited, shutting down");

    // Let in-flight clients flush the ChildExited frame before we close.
    tokio::time::sleep(Duration::from_millis(200)).await;
    accept_task.abort();

    let _ = std::fs::remove_file(&cli.sock);
    Ok(())
}

fn spawn_pty_reader(
    mut reader: Box<dyn std::io::Read + Send>,
    buffer: SharedBuffer,
    event_tx: broadcast::Sender<Event>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF; child closed stdout — child-waiter will signal exit
                Ok(n) => {
                    let bytes = buf[..n].to_vec();
                    if let Ok(mut b) = buffer.lock() {
                        b.append(bytes.clone());
                    }
                    let _ = event_tx.send(Event::Output(bytes));
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    tracing::warn!(error = %e, "pty read error; stopping reader");
                    break;
                }
            }
        }
    });
}

fn spawn_pty_writer(
    mut writer: Box<dyn std::io::Write + Send>,
    mut stdin_rx: mpsc::UnboundedReceiver<Vec<u8>>,
) {
    std::thread::spawn(move || {
        while let Some(bytes) = stdin_rx.blocking_recv() {
            if let Err(e) = writer.write_all(&bytes) {
                tracing::warn!(error = %e, "pty write error; stopping writer");
                break;
            }
            let _ = writer.flush();
        }
    });
}

fn spawn_child_waiter(
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    event_tx: broadcast::Sender<Event>,
    shutdown_tx: oneshot::Sender<()>,
) {
    tokio::task::spawn_blocking(move || {
        let status = child.wait().ok();
        let code = status.map(|s| s.exit_code() as i32);
        tracing::info!(?code, "child wait returned");
        let _ = event_tx.send(Event::Exit(code));
        let _ = shutdown_tx.send(());
    });
}

async fn accept_loop(
    listener: UnixListener,
    event_tx: broadcast::Sender<Event>,
    buffer: SharedBuffer,
    master: SharedMaster,
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    killer: Arc<Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
) {
    loop {
        match listener.accept().await {
            Ok((sock, _)) => {
                let event_rx = event_tx.subscribe();
                let buffer = buffer.clone();
                let master = master.clone();
                let stdin_tx = stdin_tx.clone();
                let killer = killer.clone();
                tokio::spawn(async move {
                    if let Err(e) =
                        handle_client(sock, event_rx, buffer, master, stdin_tx, killer).await
                    {
                        tracing::debug!(error = %e, "client ended");
                    }
                });
            }
            Err(e) => {
                tracing::warn!(error = %e, "accept failed");
                break;
            }
        }
    }
}

async fn handle_client(
    sock: UnixStream,
    mut event_rx: broadcast::Receiver<Event>,
    buffer: SharedBuffer,
    master: SharedMaster,
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    killer: Arc<Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
) -> anyhow::Result<()> {
    let (mut rd, mut wr) = sock.into_split();

    // First frame must be Attach.
    let first: ClientMsg = read_frame(&mut rd).await?;
    let (cols, rows) = match first {
        ClientMsg::Attach { cols, rows } => (cols, rows),
        other => anyhow::bail!("expected Attach as first message, got {other:?}"),
    };

    // Resize PTY to this client's viewport (latest-attach-wins). No parser
    // state to keep in sync — the snapshot is just the recent byte stream.
    apply_resize(&master, cols, rows);

    // Snapshot the recent PTY bytes; the client will feed them into xterm.js
    // which interprets them and reproduces the screen state.
    let replay = {
        let b = buffer.lock().unwrap();
        b.snapshot()
    };
    write_frame(&mut wr, &DaemonMsg::Hello { replay }).await?;

    // Fan out events to this client.
    let down_task = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(Event::Output(b)) => {
                    if write_frame(&mut wr, &DaemonMsg::Stdout(b)).await.is_err() {
                        break;
                    }
                }
                Ok(Event::Exit(code)) => {
                    let _ = write_frame(&mut wr, &DaemonMsg::ChildExited { code }).await;
                    break;
                }
                // Slow client — skip dropped frames rather than tear down.
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(lagged = n, "client lagged; dropping frames");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Read client → PTY.
    loop {
        let msg: ClientMsg = match read_frame(&mut rd).await {
            Ok(m) => m,
            Err(_) => break,
        };
        match msg {
            ClientMsg::Stdin(b) => {
                if stdin_tx.send(b).is_err() {
                    break;
                }
            }
            ClientMsg::Resize { cols, rows } => {
                apply_resize(&master, cols, rows);
            }
            ClientMsg::Attach { .. } => {
                // Ignore re-attach on a live connection.
            }
            ClientMsg::Kill => {
                tracing::info!("client requested Kill; signaling child");
                kill_child(&master, &killer);
            }
        }
    }

    // Client's read half closed; drop the sender side so down_task terminates.
    down_task.abort();
    let _ = down_task.await;
    Ok(())
}

/// Try hard to tear down the child. We first SIGHUP the whole process group
/// (portable-pty marks the child as its own session/pgid via setsid, so the
/// pgid equals the child pid), then schedule a SIGKILL fallback in case the
/// child ignored SIGHUP. Signaling the group catches transient subshells
/// (e.g. `sh -c 'bash'` spawning a separate bash process) that a single-pid
/// kill would miss.
fn kill_child(
    master: &SharedMaster,
    killer: &Arc<Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
) {
    let pgid = master
        .lock()
        .ok()
        .and_then(|m| m.process_group_leader());
    if let Some(pgid) = pgid {
        // SAFETY: killpg-style negative pid targets the process group with
        // the matching id. We created this pgid via setsid at spawn time.
        unsafe {
            libc::kill(-pgid, libc::SIGHUP);
        }
        // Hard fallback in case the child traps SIGHUP and keeps running.
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
            }
        });
    } else if let Ok(mut k) = killer.lock() {
        // Last-resort fallback through portable-pty's killer.
        let _ = k.kill();
    }
}

fn apply_resize(master: &SharedMaster, cols: u16, rows: u16) {
    if cols == 0 || rows == 0 {
        return;
    }
    let m = master.lock().unwrap();
    if let Err(e) = m.resize(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        tracing::warn!(error = %e, "pty resize failed");
    }
}

#[allow(dead_code)]
fn _ensure_is_path(_p: &Path) {} // placate some lints on older toolchains
