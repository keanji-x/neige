//! Tmux-backed session supervisor.
//!
//! Every neige session is one headless tmux session on a private tmux server
//! (socket name `neige`). The actual program (claude or a shell) runs inside
//! tmux, not as a direct child of neige-server. PTYs owned by neige-server
//! only run `tmux attach-session` — so when neige-server restarts, those
//! attach clients die but the underlying sessions (and their programs)
//! survive.
//!
//! Lifecycle:
//!   create → `has-session` check, then `tmux new-session -d -s neige-<uuid> <program>`
//!            (check-then-create — `-A` is documented to do this in one shot
//!             but tries to open a tty even with `-d`, which we can't give it
//!             from `std::process::Command`)
//!   attach → PTY runs `tmux -L neige attach-session -t neige-<uuid>`
//!   delete → `tmux kill-session -t neige-<uuid>`
//!
//! create_session is idempotent: if the session already exists (e.g. after
//! neige-server restarted), it short-circuits and the caller just reattaches
//! to the live program.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use uuid::Uuid;

/// Private tmux socket name. Isolated from the user's own tmux server.
const SOCKET: &str = "neige";

/// Our pinned tmux config. Written to `~/.config/neige/tmux.conf` on startup
/// and passed with `-f` to every tmux invocation so we never inherit the
/// user's own `.tmux.conf` (prefix keys, status bars, etc.).
const TMUX_CONF: &str = "\
# Headless tmux config for neige. Do not hand-edit — overwritten on startup.

set -g default-terminal \"xterm-256color\"

# Mouse on so wheel events reach tmux. tmux is always in the alt buffer
# from xterm.js's perspective, so xterm's own scrollback is 0 and the wheel
# would otherwise be translated into up/down arrow keys that TUIs like claude
# interpret as message-history navigation. With mouse on, xterm.js forwards
# wheel as mouse tracking escapes; the bindings below turn wheel-in-shell
# into a seamless scrollback scroll, and wheel-in-TUI into a no-op (claude
# doesn't enable mouse tracking so tmux drops the event). Side effect:
# click-drag selection now requires holding Shift (xterm.js bypass modifier).
set -g mouse on

# No status bar — we're not a human-facing tmux.
set -g status off

# No prefix key — this is a byte pipe, not an interactive multiplexer.
set -g prefix None
unbind-key -a

# Drop the root table's default mouse bindings (click/drag/double-click all
# trigger tmux's own selection/menu flows that we don't want — Shift+drag
# in xterm.js does native selection for users who want it). Then re-add
# only the wheel bindings we actually need.
unbind-key -a -T root

# Wheel-up in a plain shell (pane not in alternate screen) enters copy-mode
# with -e, which auto-exits when scrolled past the bottom — so the user
# never needs to press a key to leave. Wheel events in an alternate-screen
# pane (claude TUI) pass through as mouse events; claude doesn't enable
# mouse tracking, so tmux drops them.
bind-key -T root WheelUpPane \\
    if-shell -F -t = \"#{alternate_on}\" \\
        \"send-keys -M\" \\
        \"copy-mode -e ; send-keys -M\"
bind-key -T root WheelDownPane send-keys -M

# Big scrollback for initial-attach redraw coverage.
set -g history-limit 50000

# Responsive resize, no title/bell noise.
set -g escape-time 0
set -g allow-rename off
set -g set-titles off
set -g visual-activity off
setw -g monitor-activity off

# Follow the last-active client's size instead of forcing smallest. Means
# when the user switches device and types, tmux reflows to their screen.
# Pairs with the frontend's visibility-fit resize push.
set -g window-size latest

# Keep the pane around briefly when the program exits so the user sees the
# final output before the session dies.
set -g remain-on-exit off

# Match the pre-tmux behavior: programs were spawned via `/bin/sh -c`.
# Without this, tmux would use $SHELL and run the user's login shell init
# (zshrc / bashrc), which can change claude's environment in surprising ways.
set -g default-shell \"/bin/sh\"
set -g default-command \"\"
";

fn session_name(id: &Uuid) -> String {
    format!("neige-{}", id)
}

/// Single-quote a string for safe inclusion in a `/bin/sh -c '...'` argument.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn conf_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".config/neige/tmux.conf")
}

/// Verify `tmux` is on PATH and write our pinned config. Call once at
/// server startup. Returns an error message suitable for eprintln + exit.
pub fn init() -> Result<(), String> {
    let status = Command::new("tmux")
        .arg("-V")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("tmux binary not found on PATH ({e}). Install tmux to run neige."))?;
    if !status.success() {
        return Err("tmux -V failed — is tmux broken?".into());
    }

    let path = conf_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    std::fs::write(&path, TMUX_CONF).map_err(|e| format!("write {}: {e}", path.display()))?;
    tracing::info!("tmux config written to {}", path.display());
    Ok(())
}

fn tmux_cmd() -> Command {
    let mut cmd = Command::new("tmux");
    cmd.args(["-L", SOCKET]);
    cmd.args(["-f", &conf_path().to_string_lossy()]);
    cmd
}

fn has_session(name: &str) -> bool {
    tmux_cmd()
        .args(["has-session", "-t", name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Ensure a tmux session `neige-<id>` exists, running `program`. If the
/// session already exists (e.g. after neige-server restart), this is a
/// no-op and `program`/env/cwd are ignored — the user reattaches to the
/// live process.
///
/// Returns `true` when a fresh session was created, `false` when one
/// already existed. The caller uses this to decide whether to roll back
/// (kill the fresh session) on a subsequent failure.
///
/// We check-then-create rather than using `-A`. `-A` is documented to
/// attach-if-exists, but tmux's attach path wants a controlling tty even
/// with `-d`, which we don't have when invoking via `std::process::Command`.
pub fn create_session(
    id: &Uuid,
    program: &str,
    cwd: &str,
    env: &[(String, String)],
) -> Result<bool, String> {
    let session = session_name(id);
    if has_session(&session) {
        tracing::debug!("tmux session {session} already exists, skipping create");
        return Ok(false);
    }

    let mut cmd = tmux_cmd();
    cmd.args(["new-session", "-d"]);
    cmd.args(["-s", &session]);
    cmd.args(["-c", cwd]);
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.arg(program);
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());

    let out = cmd
        .output()
        .map_err(|e| format!("tmux new-session spawn: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("tmux new-session failed: {}", err.trim()));
    }
    Ok(true)
}

/// Shell command to attach to an existing session. Handed to
/// `PtySession::spawn` which runs it via `/bin/sh -c`.
pub fn attach_command(id: &Uuid) -> String {
    format!(
        "exec tmux -L {} -f {} attach-session -t {}",
        SOCKET,
        shell_quote(&conf_path().to_string_lossy()),
        session_name(id),
    )
}

/// Best-effort. Logs but does not return an error — we call this on delete
/// and on rollback paths where losing cleanup visibility is not fatal.
pub fn kill_session(id: &Uuid) {
    let session = session_name(id);
    let status = tmux_cmd()
        .args(["kill-session", "-t", &session])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() => tracing::debug!("tmux kill-session {session} ok"),
        Ok(s) => tracing::debug!("tmux kill-session {session}: exit {s} (probably already gone)"),
        Err(e) => tracing::warn!("tmux kill-session {session} spawn: {e}"),
    }
}
