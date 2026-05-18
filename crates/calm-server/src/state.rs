//! Shared app state passed to every handler.
//!
//! `Clone` is cheap — everything inside is wrapped in `Arc` or already
//! reference-counted internally.

use crate::db::Repo;
use crate::event::EventBus;
use crate::plugin_host::PluginHost;
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

/// Track D fills this with whatever shape it needs (likely a thin pool of
/// per-terminal unix socket clients keyed by terminal id, plus a spawn helper).
/// For now it's an empty marker so `AppState` can compile.
pub struct DaemonClient {
    // e.g. session_root: PathBuf, daemons: Mutex<HashMap<TerminalId, ...>>
}

impl DaemonClient {
    /// Placeholder. Track D replaces with real init.
    pub fn new_stub() -> Self {
        Self {}
    }
}
