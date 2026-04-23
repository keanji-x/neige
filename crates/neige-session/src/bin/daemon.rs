//! neige-session-daemon — per-session PTY supervisor.
//!
//! Spawns the user's program under a PTY, runs it under a vt100 state machine,
//! accepts multiple clients over a Unix socket, and broadcasts PTY output to
//! every attached client. Survives all client disconnects; exits when the
//! child does.

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

    /// Scrollback buffer size in lines, passed to vt100::Parser.
    #[arg(long, default_value_t = 10_000)]
    scrollback: usize,

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

type SharedParser = Arc<Mutex<vt100::Parser>>;
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
    // Inherit TERM from the parent; otherwise some programs refuse to render.
    cmd.env("TERM", std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".into()));
    let child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let parser: SharedParser = Arc::new(Mutex::new(vt100::Parser::new(
        cli.rows,
        cli.cols,
        cli.scrollback,
    )));
    let master: SharedMaster = Arc::new(Mutex::new(pair.master));
    let (event_tx, _) = broadcast::channel::<Event>(2048);
    let (stdin_tx, stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // ---- PTY reader → vt100 + broadcast ----
    let reader = master.lock().unwrap().try_clone_reader()?;
    spawn_pty_reader(reader, parser.clone(), event_tx.clone());

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
        parser.clone(),
        master.clone(),
        stdin_tx.clone(),
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
    parser: SharedParser,
    event_tx: broadcast::Sender<Event>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF; child closed stdout — child-waiter will signal exit
                Ok(n) => {
                    let bytes = &buf[..n];
                    if let Ok(mut p) = parser.lock() {
                        p.process(bytes);
                    }
                    let _ = event_tx.send(Event::Output(bytes.to_vec()));
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
    parser: SharedParser,
    master: SharedMaster,
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
) {
    loop {
        match listener.accept().await {
            Ok((sock, _)) => {
                let event_rx = event_tx.subscribe();
                let parser = parser.clone();
                let master = master.clone();
                let stdin_tx = stdin_tx.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(sock, event_rx, parser, master, stdin_tx).await {
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
    parser: SharedParser,
    master: SharedMaster,
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
) -> anyhow::Result<()> {
    let (mut rd, mut wr) = sock.into_split();

    // First frame must be Attach.
    let first: ClientMsg = read_frame(&mut rd).await?;
    let (cols, rows) = match first {
        ClientMsg::Attach { cols, rows } => (cols, rows),
        other => anyhow::bail!("expected Attach as first message, got {other:?}"),
    };

    // Resize PTY to this client's viewport (latest-attach-wins) and keep the
    // vt100 parser in sync so the replay we ship below matches.
    apply_resize(&master, &parser, cols, rows);

    // Snapshot the grid as bytes the client can feed directly into their
    // terminal to reproduce our current state.
    let replay = {
        let p = parser.lock().unwrap();
        p.screen().contents_formatted()
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
                apply_resize(&master, &parser, cols, rows);
            }
            ClientMsg::Attach { .. } => {
                // Ignore re-attach on a live connection.
            }
        }
    }

    // Client's read half closed; drop the sender side so down_task terminates.
    down_task.abort();
    let _ = down_task.await;
    Ok(())
}

fn apply_resize(master: &SharedMaster, parser: &SharedParser, cols: u16, rows: u16) {
    if cols == 0 || rows == 0 {
        return;
    }
    {
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
    {
        let mut p = parser.lock().unwrap();
        p.screen_mut().set_size(rows, cols);
    }
}

#[allow(dead_code)]
fn _ensure_is_path(_p: &Path) {} // placate some lints on older toolchains
