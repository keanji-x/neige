//! `/api/cards/:id/terminal` — create the Terminal row for a "terminal" card
//! and spawn its `neige-session-daemon`. **Owned by Track D.**
//!
//! ## Track D's job
//!
//! 1. POST handler: validate the card exists and its `kind == "terminal"`,
//!    then `repo.terminal_create(...)` and `state.daemon.spawn(...)`. Persist
//!    the daemon handle (socket path, pid, whatever you pick) via
//!    `repo.terminal_set_handle`.
//! 2. Defaults: empty `program` → `$SHELL` (`/bin/sh` fallback); empty `cwd`
//!    → `$HOME` (cwd fallback). Same semantics as `neige-server`'s
//!    `conversation/mod.rs` defaults.
//! 3. The WS half lives in `ws/terminal.rs`.

use crate::error::{CalmError, Result};
use crate::model::Terminal;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::post,
};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/cards/{card_id}/terminal", post(create))
}

#[derive(Deserialize, Debug)]
pub struct NewTerminalBody {
    /// Empty string or missing → `$SHELL` (then `/bin/sh`).
    #[serde(default)]
    pub program: String,
    /// Empty string or missing → `$HOME` (then cwd of server).
    #[serde(default)]
    pub cwd: String,
    /// Extra env on top of the inherited set. JSON object: `{"FOO":"bar"}`.
    #[serde(default)]
    pub env: serde_json::Value,
}

async fn create(
    State(s): State<AppState>,
    Path(card_id): Path<String>,
    Json(p): Json<NewTerminalBody>,
) -> Result<(StatusCode, Json<Terminal>)> {
    let _ = (s, card_id, p);
    todo!("track D: resolve defaults, repo.terminal_create, daemon.spawn, set_handle")
}

#[allow(dead_code)]
fn _placeholder() -> CalmError {
    CalmError::Internal("terminal endpoint not yet implemented".into())
}
