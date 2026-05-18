//! Shared app state passed to every handler.
//!
//! `Clone` is cheap — everything inside is wrapped in `Arc` or already
//! reference-counted internally.

use crate::config::Config;
use crate::db::Repo;
use crate::event::EventBus;
use crate::plugin_host::PluginHost;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub repo: Arc<dyn Repo>,
    pub events: EventBus,
    pub daemon: Arc<DaemonClient>,
    pub plugin: Arc<PluginHost>,
}

// ---------------------------------------------------------------------------
// DaemonClient — owned by Track D.
//
// Wraps the connection / spawning logic for `neige-session-daemon` so REST
// + WS terminal handlers can talk to PTYs without leaking the framed-binary
// protocol details into the rest of the codebase.
// ---------------------------------------------------------------------------

/// Lightweight handle the REST + WS halves both consult. The handle is
/// "lightweight" because the daemon is its own long-lived process — we don't
/// pool stream connections through here; instead WS handlers connect on
/// demand using the stored socket path. All `DaemonClient` needs to do is
/// (a) know where to put per-terminal sockets and (b) know which binary to
/// spawn.
pub struct DaemonClient {
    /// Per-terminal sockets live under this directory as `<terminal_id>.sock`.
    /// Created on first use by `routes::terminal::create`. Defaults to
    /// `<config.data_dir>/terminals`.
    pub data_dir: PathBuf,
    /// Path to the `neige-session-daemon` binary. Resolved at startup to be
    /// a sibling of the running `calm-server` exe (so `cargo run` /
    /// `target/release` layouts work without an install step); falls back to
    /// `neige-session-daemon` and lets `$PATH` lookup happen at spawn.
    pub session_daemon_bin: PathBuf,
}

impl DaemonClient {
    /// Real constructor. Pulls `data_dir` from the resolved config and
    /// locates the daemon binary next to the current executable.
    pub fn new(cfg: &Config) -> Self {
        let data_dir = cfg.data_dir_resolved().join("terminals");
        Self {
            data_dir,
            session_daemon_bin: resolve_session_daemon_bin(),
        }
    }

    /// Placeholder for tests / dev paths that don't have a full `Config`.
    /// Sockets land in a per-uid tempdir; binary lookup falls back to `$PATH`.
    pub fn new_stub() -> Self {
        let tmp = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join("calm-terminals");
        Self {
            data_dir: tmp,
            session_daemon_bin: resolve_session_daemon_bin(),
        }
    }

    /// Socket path for a given terminal id.
    pub fn sock_path(&self, terminal_id: &str) -> PathBuf {
        self.data_dir.join(format!("{terminal_id}.sock"))
    }
}

/// Prefer a sibling of the running executable (works for `cargo run` and
/// release layouts). Fall back to the bare name so PATH lookup happens at
/// spawn time if the sibling isn't there.
fn resolve_session_daemon_bin() -> PathBuf {
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
