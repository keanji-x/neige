//! Daemon lifecycle for the neige-session backend.
//!
//! Each session is one `neige-session-daemon` process listening on a
//! per-session Unix socket. The daemon is spawned as a normal child of
//! neige-server but its cgroup membership is controlled by the systemd unit
//! — set `KillMode=process` on neige.service so that daemons survive a
//! `systemctl restart`, matching tmux's old "sessions outlive neige-server"
//! property.
//!
//! Socket convention: `$XDG_RUNTIME_DIR/neige/<uuid>.sock`, falling back to
//! `/tmp/neige-<uid>/<uuid>.sock` when XDG_RUNTIME_DIR isn't set (old-school
//! Linux, containers without a user session).

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::net::UnixStream;
use tokio::process::Command;
use uuid::Uuid;

use neige_session::{ClientMsg, write_frame};

/// Compute the socket path for a given session id. Callers don't need to
/// create the parent dir; [`create_session`] handles that.
pub fn sock_path(id: &Uuid) -> PathBuf {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            // SAFETY: getuid is always safe on Unix.
            let uid = unsafe { libc::getuid() };
            PathBuf::from(format!("/tmp/neige-{uid}"))
        });
    base.join("neige").join(format!("{id}.sock"))
}

/// A daemon for `id` is reachable (socket bound + accepting).
pub async fn is_alive(id: &Uuid) -> bool {
    UnixStream::connect(sock_path(id)).await.is_ok()
}

/// Resolve the daemon binary. Prefer a sibling of the running neige-server
/// (so `cargo run` / `target/release` setups work without any install step);
/// fall back to $PATH.
fn daemon_binary_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("neige-session-daemon");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    PathBuf::from("neige-session-daemon")
}

/// Ensure a daemon is running for `id`. Idempotent: if one is already live,
/// `program` / `cwd` / `env` are ignored and the caller just reattaches.
/// Returns `Ok(true)` when a fresh daemon was spawned.
pub async fn create_session(
    id: &Uuid,
    program: &str,
    cwd: &str,
    env: &[(String, String)],
) -> Result<bool, String> {
    if is_alive(id).await {
        return Ok(false);
    }

    let sock = sock_path(id);
    if let Some(parent) = sock.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir sock parent: {e}"))?;
    }
    // Clear any stale socket file from a previous crashed daemon, so bind
    // inside the daemon doesn't hit EADDRINUSE.
    if sock.exists() {
        let _ = std::fs::remove_file(&sock);
    }

    let daemon_bin = daemon_binary_path();
    let mut cmd = Command::new(&daemon_bin);
    cmd.args(["--id", &id.to_string()]);
    cmd.args(["--sock", &sock.to_string_lossy()]);
    cmd.args(["--cwd", cwd]);
    cmd.args(["--", "/bin/sh", "-c", program]);
    // Pass through the env neige-server normally hands programs. The daemon
    // forwards its own env to the child CommandBuilder.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // kill_on_drop defaults to false for tokio::process::Command, which
        // is what we want — if neige-server drops this handle, the daemon
        // keeps running so the user's session survives a server restart.
        .kill_on_drop(false);

    let mut child = cmd.spawn().map_err(|e| format!("spawn daemon: {e}"))?;
    let daemon_pid = child.id();
    tracing::info!(pid = ?daemon_pid, id = %id, "spawned neige-session-daemon");

    // Reap the daemon if it exits while we're still running. Without this
    // task the handle gets dropped and we'd leak a zombie (only on the
    // happy path where neige-server outlives the daemon, which is rare).
    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    // The daemon binds its socket before it starts accepting — poll until
    // we can connect or the budget runs out. 40ms × 75 = 3s, generous.
    for _ in 0..75 {
        if is_alive(id).await {
            return Ok(true);
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
    Err(format!("daemon for {id} did not become ready"))
}

/// Best-effort kill. Opens the daemon's socket, sends Attach (required first
/// frame) then Kill, and drops. The daemon SIGHUPs the child; the child exit
/// tears down the daemon.
pub async fn kill_session(id: &Uuid) {
    let Ok(sock) = UnixStream::connect(sock_path(id)).await else {
        // Already gone.
        return;
    };
    let (_, mut wr) = sock.into_split();
    let _ = write_frame(&mut wr, &ClientMsg::Attach { cols: 80, rows: 24 }).await;
    let _ = write_frame(&mut wr, &ClientMsg::Kill).await;
    // Give the kernel a beat to flush the bytes before we drop `wr`; some
    // runtimes race the FIN ahead of tiny pending writes. Cheap insurance.
    tokio::time::sleep(Duration::from_millis(50)).await;
    drop(wr);
    tracing::debug!("sent Kill to session daemon {id}");
}
