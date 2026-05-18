//! `/api/cards/:id/terminal` — create the Terminal row for a "terminal" card
//! and spawn its `neige-session-daemon`. **Owned by Track D.**
//!
//! ## Flow
//!
//! 1. Validate the card exists and its `kind == "terminal"`.
//! 2. Resolve defaults: empty `program` → `$SHELL` (fallback `/bin/sh`);
//!    empty `cwd` → `$HOME` (fallback server cwd). Mirrors
//!    `neige-server`'s `conversation::default_program` / `default_cwd`.
//! 3. Persist the row via `repo.terminal_create` so we own a stable
//!    terminal id (used as the socket filename).
//! 4. Spawn `neige-session-daemon` with `--id <uuid> --sock <path>
//!    --cwd <cwd> -- /bin/sh -c <program>`. The daemon binds the socket
//!    and writes a "ready" marker to a pipe fd we hand it; here we just
//!    poll the socket path for connectability (matches neige-server's
//!    approach in `attach/daemon.rs`).
//! 5. Stamp `daemon_handle` on the Terminal row to the socket path so the
//!    WS half can find it on `/api/terminals/:id` without recomputing.

use crate::error::{CalmError, Result};
use crate::model::{NewTerminal, Terminal};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::post,
};
use serde::Deserialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::net::UnixStream;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/cards/{card_id}/terminal",
        post(create).get(get_for_card),
    )
}

/// Look up the Terminal row a card owns. Returns 404 if the card has no
/// terminal (yet). The UI uses this to validate a card_id cached in
/// localStorage before attempting a WS attach to its terminal.
async fn get_for_card(
    State(s): State<AppState>,
    Path(card_id): Path<String>,
) -> Result<Json<Terminal>> {
    let term = s
        .repo
        .terminal_get_by_card(&card_id)
        .await?
        .ok_or_else(|| CalmError::NotFound(format!("terminal for card {card_id}")))?;
    Ok(Json(term))
}

#[derive(Deserialize, Debug, Default)]
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
    body: Option<Json<NewTerminalBody>>,
) -> Result<(StatusCode, Json<Terminal>)> {
    let Json(p) = body.unwrap_or_default();

    // 1. Card exists and is a terminal.
    let card = s
        .repo
        .card_get(&card_id)
        .await?
        .ok_or_else(|| CalmError::NotFound(format!("card {card_id}")))?;
    if card.kind != "terminal" {
        return Err(CalmError::BadRequest(format!(
            "card {card_id} kind={} (need 'terminal')",
            card.kind
        )));
    }

    // 2. Defaults.
    let program = if p.program.trim().is_empty() {
        default_program()
    } else {
        p.program
    };
    let cwd = if p.cwd.trim().is_empty() {
        default_cwd()
    } else {
        p.cwd
    };
    let env = if p.env.is_null() {
        serde_json::json!({})
    } else {
        p.env
    };

    // 3. Persist the row.
    let term = s
        .repo
        .terminal_create(NewTerminal {
            card_id: card_id.clone(),
            program: program.clone(),
            cwd: cwd.clone(),
            env: env.clone(),
        })
        .await?;

    // 4. Compute socket path under the configured data dir + spawn daemon.
    let sock = s.daemon.sock_path(&term.id);
    if let Some(parent) = sock.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| CalmError::Internal(format!("mkdir sock parent: {e}")))?;
    }
    if sock.exists() {
        let _ = std::fs::remove_file(&sock);
    }

    let sock_str = sock.to_string_lossy().to_string();

    let mut cmd = tokio::process::Command::new(&s.daemon.session_daemon_bin);
    cmd.args(["--id", &term.id])
        .args(["--sock", &sock_str])
        .args(["--cwd", &cwd])
        .arg("--")
        .args(["/bin/sh", "-c", &program]);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Extra env from the JSON payload. Only flat string→string is honored;
    // anything else is ignored quietly to avoid leaking serialization quirks
    // into the daemon process env.
    if let Some(map) = env.as_object() {
        for (k, v) in map {
            if let Some(s) = v.as_str() {
                cmd.env(k, s);
            }
        }
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false);

    let mut child = cmd
        .spawn()
        .map_err(|e| CalmError::Internal(format!("spawn neige-session-daemon: {e}")))?;
    let pid = child.id();
    tracing::info!(pid = ?pid, terminal_id = %term.id, "spawned neige-session-daemon");

    // Reap. The daemon outlives this `tokio::Child`; we just don't want a
    // zombie if it exits early. Detached lifecycle is fine — calm-server is
    // not the daemon's supervisor.
    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    // 5. Poll the socket until the daemon is accepting connections (or give
    // up after ~3s).
    let mut ready = false;
    for _ in 0..75 {
        if UnixStream::connect(&sock).await.is_ok() {
            ready = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
    if !ready {
        return Err(CalmError::Internal(format!(
            "daemon for terminal {} did not become ready",
            term.id
        )));
    }

    // 6. Stamp the handle on the row and re-fetch so the response carries it.
    s.repo
        .terminal_set_handle(&term.id, Some(&sock_str))
        .await?;
    let term = s
        .repo
        .terminal_get(&term.id)
        .await?
        .ok_or_else(|| CalmError::Internal("terminal vanished after create".into()))?;

    Ok((StatusCode::CREATED, Json(term)))
}

fn default_program() -> String {
    let s = std::env::var("SHELL").unwrap_or_default();
    if s.is_empty() {
        "/bin/sh".to_string()
    } else {
        s
    }
}

fn default_cwd() -> String {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return home;
        }
    }
    std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}
