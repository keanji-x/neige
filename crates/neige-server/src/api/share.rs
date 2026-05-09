//! Public read-only share links for chat-mode sessions.
//!
//! Flow:
//!   1. `POST /api/conversations/{id}/share` — auth-required. Looks up the
//!      session, generates a fresh URL token (32 bytes base64url), stores
//!      `.neige/shares/<blake3-hash>.json` with the metadata needed for
//!      rendering (title, cwd, created_at, target session_id), and returns
//!      `{ token, url }` so the UI can display the share link.
//!   2. `GET /api/share/{token}/manifest` — public. Hashes the URL token,
//!      reads the on-disk manifest, returns metadata.
//!   3. `GET /api/share/{token}/jsonl` — public. Reads the Claude CLI jsonl
//!      from `~/.claude/projects/...` and streams it back as `application/x-ndjson`.
//!   4. `GET /share/{token}` — public. Returns the SPA index.html so the
//!      client-side router can mount `<SharePage>`. Wired in `main.rs` rather
//!      than this module since it needs the static_dir path.
//!
//! Defense-in-depth: only the blake3 hash of the token lands on disk, so a
//! leaked listing of `.neige/shares/` does not yield usable links — same
//! pattern as `~/.config/neige/auth.json`.

use std::path::PathBuf;

use axum::{
    Json,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::AppState;
use crate::auth::{generate_token, hash_token};
use crate::conversation::{find_session_jsonl, neige_dir};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareManifest {
    pub session_id: Uuid,
    pub session_cwd: String,
    pub session_title: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct CreateShareResponse {
    pub token: String,
    pub url: String,
    pub manifest: ShareManifest,
}

fn shares_dir(project_cwd: &str) -> PathBuf {
    neige_dir(project_cwd).join("shares")
}

/// Filename component for the on-disk manifest. The blake3 hash is hex-encoded
/// without the `blake3:` prefix that `hash_token` adds (we only need the
/// digest as a filename here).
fn share_filename(token: &str) -> String {
    let full = hash_token(token); // "blake3:<hex>"
    let hex = full.strip_prefix("blake3:").unwrap_or(&full);
    format!("{}.json", hex)
}

fn manifest_path(project_cwd: &str, token: &str) -> PathBuf {
    shares_dir(project_cwd).join(share_filename(token))
}

fn write_manifest(project_cwd: &str, token: &str, manifest: &ShareManifest) -> std::io::Result<()> {
    let dir = shares_dir(project_cwd);
    std::fs::create_dir_all(&dir)?;
    let path = manifest_path(project_cwd, token);
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(path, json)
}

fn read_manifest(project_cwd: &str, token: &str) -> Option<ShareManifest> {
    let path = manifest_path(project_cwd, token);
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(super) async fn create_share(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let manifest = {
        let mgr = state.manager.lock().await;
        let conv = mgr
            .get(&id)
            .ok_or((StatusCode::NOT_FOUND, "conversation not found".to_string()))?;
        // Resolve the jsonl up-front so we fail fast if the session has no
        // on-disk transcript yet (terminal-mode sessions, or chat sessions
        // that haven't produced a single turn).
        if find_session_jsonl(&conv.id, &conv.cwd).is_none() {
            return Err((
                StatusCode::CONFLICT,
                "no on-disk transcript yet — send at least one message first".to_string(),
            ));
        }
        ShareManifest {
            session_id: conv.id,
            session_cwd: conv.cwd.clone(),
            session_title: conv.title.clone(),
            created_at: Utc::now(),
        }
    };

    let token = generate_token();
    let project_cwd = {
        let mgr = state.manager.lock().await;
        mgr.project_cwd().to_string()
    };
    write_manifest(&project_cwd, &token, &manifest).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("write share manifest: {e}"),
        )
    })?;

    Ok(Json(CreateShareResponse {
        url: format!("/share/{}", token),
        token,
        manifest,
    }))
}

pub(super) async fn share_manifest(
    State(state): State<AppState>,
    axum::extract::Path(token): axum::extract::Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let project_cwd = {
        let mgr = state.manager.lock().await;
        mgr.project_cwd().to_string()
    };
    let manifest = read_manifest(&project_cwd, &token).ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(manifest))
}

pub(super) async fn share_jsonl(
    State(state): State<AppState>,
    axum::extract::Path(token): axum::extract::Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let project_cwd = {
        let mgr = state.manager.lock().await;
        mgr.project_cwd().to_string()
    };
    let manifest = read_manifest(&project_cwd, &token).ok_or(StatusCode::NOT_FOUND)?;
    let jsonl_path =
        find_session_jsonl(&manifest.session_id, &manifest.session_cwd).ok_or(StatusCode::GONE)?;
    let bytes = std::fs::read(&jsonl_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut resp = (StatusCode::OK, bytes).into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/x-ndjson; charset=utf-8"),
    );
    Ok(resp)
}

/// Serve the SPA index.html under `/share/{token}` so the client-side router
/// can mount the read-only viewer. The actual file path is resolved by the
/// caller (in `main.rs`) since this module doesn't know `static_dir`.
pub async fn share_index_html(static_dir: PathBuf) -> Result<axum::response::Response, StatusCode> {
    let path = static_dir.join("index.html");
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut resp = (StatusCode::OK, bytes).into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    Ok(resp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_filename_is_stable_for_same_token() {
        let tok = "abc123";
        assert_eq!(share_filename(tok), share_filename(tok));
        assert!(share_filename(tok).ends_with(".json"));
    }

    #[test]
    fn share_filename_differs_per_token() {
        assert_ne!(share_filename("a"), share_filename("b"));
    }

    #[test]
    fn share_filename_hex_only() {
        // Filename must be filesystem-safe (no /, no :, etc).
        let f = share_filename("some-token");
        let stem = f.strip_suffix(".json").unwrap();
        assert!(stem.chars().all(|c| c.is_ascii_hexdigit()));
        // blake3 256-bit digest = 32 bytes = 64 hex chars
        assert_eq!(stem.len(), 64);
    }

    /// Lightweight RAII tmpdir without pulling in `tempfile`. The dir is
    /// created under the OS temp dir with a unique name and removed on drop.
    struct TmpDir(PathBuf);
    impl TmpDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("neige-share-test-{}", Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("mkdir tmp");
            Self(path)
        }
    }
    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn write_and_read_manifest_round_trip() {
        let dir = TmpDir::new();
        let project_cwd = dir.0.to_string_lossy().to_string();
        let token = generate_token();
        let manifest = ShareManifest {
            session_id: Uuid::new_v4(),
            session_cwd: "/some/cwd".to_string(),
            session_title: "test".to_string(),
            created_at: Utc::now(),
        };
        write_manifest(&project_cwd, &token, &manifest).unwrap();
        let loaded = read_manifest(&project_cwd, &token).unwrap();
        assert_eq!(loaded.session_id, manifest.session_id);
        assert_eq!(loaded.session_cwd, manifest.session_cwd);
        assert_eq!(loaded.session_title, manifest.session_title);
    }

    #[test]
    fn read_manifest_missing_returns_none() {
        let dir = TmpDir::new();
        let project_cwd = dir.0.to_string_lossy().to_string();
        assert!(read_manifest(&project_cwd, "nope").is_none());
    }

    #[test]
    fn wrong_token_does_not_resolve_existing_share() {
        let dir = TmpDir::new();
        let project_cwd = dir.0.to_string_lossy().to_string();
        let real = generate_token();
        let manifest = ShareManifest {
            session_id: Uuid::new_v4(),
            session_cwd: "/x".to_string(),
            session_title: "t".to_string(),
            created_at: Utc::now(),
        };
        write_manifest(&project_cwd, &real, &manifest).unwrap();
        assert!(read_manifest(&project_cwd, "wrong").is_none());
    }
}
