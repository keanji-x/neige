use axum::{extract::State, http::StatusCode, response::IntoResponse};

use super::AppState;
use crate::conversation::neige_dir;

fn config_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".config/neige/config.json")
}

pub(super) async fn get_config() -> impl IntoResponse {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            content,
        ),
        Err(_) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            "{}".to_string(),
        ),
    }
}

pub(super) async fn save_config(body: String) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Validate it's valid JSON
    serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid json: {e}")))?;

    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("mkdir: {e}")))?;
    }
    std::fs::write(&path, &body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("write: {e}")))?;

    Ok(StatusCode::OK)
}

fn layout_path(mgr: &crate::conversation::ConversationManager) -> std::path::PathBuf {
    neige_dir(mgr.project_cwd()).join("layout.json")
}

pub(super) async fn get_layout(State(state): State<AppState>) -> impl IntoResponse {
    let mgr = state.manager.lock().await;
    let path = layout_path(&mgr);
    match std::fs::read_to_string(&path) {
        Ok(content) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            content,
        ),
        Err(_) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            "null".to_string(),
        ),
    }
}

pub(super) async fn save_layout(
    State(state): State<AppState>,
    body: String,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid json: {e}")))?;

    let mgr = state.manager.lock().await;
    let path = layout_path(&mgr);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("mkdir: {e}")))?;
    }
    std::fs::write(&path, &body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("write: {e}")))?;
    Ok(StatusCode::OK)
}
