//! Boot-time configuration. Read once in `main`, frozen for the process.

use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(name = "calm-server", about = "Neige Calm kernel")]
pub struct Config {
    /// HTTP listen address.
    #[arg(long, env = "CALM_LISTEN", default_value = "127.0.0.1:4040")]
    pub listen: String,

    /// Storage URL. `sqlite://path/to/file.db?mode=rwc` or `mock` for the
    /// in-memory `MockRepo` (handy for dev before track A lands).
    #[arg(long, env = "CALM_DB_URL", default_value = "mock")]
    pub db_url: String,

    /// Root directory for runtime state (PTY sockets, daemon scratch).
    /// Defaults to `<XDG_DATA_HOME>/calm` or `~/.local/share/calm`.
    #[arg(long, env = "CALM_DATA_DIR")]
    pub data_dir: Option<PathBuf>,

    /// CORS origin allowed by the API (typically the web-calm dev origin).
    #[arg(long, env = "CALM_ALLOWED_ORIGIN", default_value = "http://localhost:5175")]
    pub allowed_origin: String,
}

impl Config {
    pub fn data_dir_resolved(&self) -> PathBuf {
        self.data_dir.clone().unwrap_or_else(|| {
            let base = std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| {
                    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share"))
                })
                .unwrap_or_else(|| PathBuf::from("."));
            base.join("calm")
        })
    }
}
