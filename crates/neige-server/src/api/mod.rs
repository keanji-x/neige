use axum::{
    Router,
    extract::{Path, State, WebSocketUpgrade, ws::{Message, WebSocket}},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::conversation::{CreateConvRequest, SharedManager, neige_dir};

#[derive(Clone)]
pub struct AppState {
    pub manager: SharedManager,
}

#[derive(serde::Serialize)]
struct BrowseResponse {
    path: String,
    entries: Vec<DirEntryInfo>,
    is_git_repo: bool,
}

#[derive(serde::Serialize)]
struct DirEntryInfo {
    name: String,
    is_dir: bool,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/conversations", get(list_convs))
        .route("/api/conversations", post(create_conv))
        .route("/api/browse", get(browse_dir))
        .route("/api/file", get(read_file))
        .route("/api/files", get(search_files))
        .route("/api/conversations/{id}", delete(delete_conv))
        .route("/api/conversations/{id}", axum::routing::patch(patch_conv))
        .route("/api/conversations/{id}/resume", post(resume_conv))
        .route("/api/config", get(get_config))
        .route("/api/config", post(save_config))
        .route("/api/layout", get(get_layout))
        .route("/api/layout", post(save_layout))
        .route("/ws/{id}", get(ws_handler))
        .with_state(state)
}

fn config_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".config/neige/config.json")
}

async fn get_config() -> impl IntoResponse {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            (StatusCode::OK, [(axum::http::header::CONTENT_TYPE, "application/json")], content)
        }
        Err(_) => {
            (StatusCode::OK, [(axum::http::header::CONTENT_TYPE, "application/json")], "{}".to_string())
        }
    }
}

async fn save_config(body: String) -> Result<impl IntoResponse, (StatusCode, String)> {
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

async fn get_layout(State(state): State<AppState>) -> impl IntoResponse {
    let mgr = state.manager.lock().await;
    let path = layout_path(&mgr);
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            (StatusCode::OK, [(axum::http::header::CONTENT_TYPE, "application/json")], content)
        }
        Err(_) => {
            (StatusCode::OK, [(axum::http::header::CONTENT_TYPE, "application/json")], "null".to_string())
        }
    }
}

async fn save_layout(
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

async fn list_convs(State(state): State<AppState>) -> impl IntoResponse {
    let mgr = state.manager.lock().await;
    Json(mgr.list())
}

async fn create_conv(
    State(state): State<AppState>,
    Json(req): Json<CreateConvRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut mgr = state.manager.lock().await;
    let info = mgr
        .create(req)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok((StatusCode::CREATED, Json(info)))
}

async fn delete_conv(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    let mut mgr = state.manager.lock().await;
    mgr.remove(&id);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct PatchConvRequest {
    title: Option<String>,
}

async fn patch_conv(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<PatchConvRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut mgr = state.manager.lock().await;
    let info = mgr
        .update(&id, req.title.as_deref())
        .ok_or((StatusCode::NOT_FOUND, "not found".to_string()))?;
    Ok(Json(info))
}

async fn resume_conv(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut mgr = state.manager.lock().await;
    let info = mgr
        .resume(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(info))
}

#[derive(Deserialize)]
struct BrowseQuery {
    path: Option<String>,
}

async fn browse_dir(
    axum::extract::Query(q): axum::extract::Query<BrowseQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let raw = q.path.unwrap_or_else(|| "~".to_string());
    let expanded = if raw.starts_with('~') {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        raw.replacen('~', &home, 1)
    } else {
        raw
    };

    let path = std::path::Path::new(&expanded);
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid path: {e}")))?;

    let mut entries = Vec::new();
    let read = std::fs::read_dir(&canonical)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("cannot read dir: {e}")))?;

    for entry in read.flatten() {
        let meta = entry.metadata();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        entries.push(DirEntryInfo { name, is_dir });
    }

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    let canonical_str = canonical.to_string_lossy().to_string();
    let is_git_repo = crate::conversation::is_git_repo_public(&canonical_str);

    Ok(Json(BrowseResponse {
        path: canonical_str,
        entries,
        is_git_repo,
    }))
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

#[derive(serde::Serialize)]
struct FileResponse {
    path: String,
    content: String,
    language: String,
}

async fn read_file(
    axum::extract::Query(q): axum::extract::Query<FileQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let expanded = if q.path.starts_with('~') {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        q.path.replacen('~', &home, 1)
    } else {
        q.path
    };

    let path = std::path::Path::new(&expanded);
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid path: {e}")))?;

    // Safety: only read regular files, limit size to 2MB
    let meta = std::fs::metadata(&canonical)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("cannot stat: {e}")))?;
    if !meta.is_file() {
        return Err((StatusCode::BAD_REQUEST, "not a file".to_string()));
    }
    if meta.len() > 2 * 1024 * 1024 {
        return Err((StatusCode::BAD_REQUEST, "file too large (>2MB)".to_string()));
    }

    let content = std::fs::read_to_string(&canonical)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("cannot read: {e}")))?;

    let language = canonical.extension()
        .and_then(|e| e.to_str())
        .map(|ext| match ext {
            "rs" => "rust",
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "py" => "python",
            "md" | "markdown" => "markdown",
            "json" => "json",
            "toml" => "toml",
            "yaml" | "yml" => "yaml",
            "css" => "css",
            "html" => "html",
            "sh" | "bash" | "zsh" => "shell",
            "sql" => "sql",
            "go" => "go",
            "java" => "java",
            "c" | "h" => "c",
            "cpp" | "hpp" | "cc" => "cpp",
            "rb" => "ruby",
            "swift" => "swift",
            "kt" => "kotlin",
            "lua" => "lua",
            "r" => "r",
            "xml" => "xml",
            "csv" => "csv",
            "txt" => "text",
            _ => ext,
        })
        .unwrap_or("text")
        .to_string();

    Ok(Json(FileResponse {
        path: canonical.to_string_lossy().to_string(),
        content,
        language,
    }))
}

#[derive(Deserialize)]
struct SearchFilesQuery {
    path: String,
    query: Option<String>,
}

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

async fn search_files(
    axum::extract::Query(q): axum::extract::Query<SearchFilesQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let expanded = if q.path.starts_with('~') {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        q.path.replacen('~', &home, 1)
    } else {
        q.path.clone()
    };

    let root = std::fs::canonicalize(&expanded)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid path: {e}")))?;

    let query = q.query.unwrap_or_default().to_lowercase();
    let mut results: Vec<FileEntry> = Vec::new();
    let max_results = 50;

    fn walk(
        dir: &std::path::Path,
        root: &std::path::Path,
        query: &str,
        results: &mut Vec<FileEntry>,
        max: usize,
        depth: usize,
    ) {
        if depth > 6 || results.len() >= max {
            return;
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if results.len() >= max {
                return;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden dirs and common large dirs
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" || name == "dist" || name == "build" {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let path = entry.path();
            let rel_path = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().to_string();

            if meta.is_file() {
                if query.is_empty() || name.to_lowercase().contains(query) || rel_path.to_lowercase().contains(query) {
                    results.push(FileEntry {
                        name,
                        path: rel_path,
                        is_dir: false,
                    });
                }
            } else if meta.is_dir() {
                walk(&path, root, query, results, max, depth + 1);
            }
        }
    }

    walk(&root, &root, &query, &mut results, max_results, 0);
    // Sort: prioritize exact filename matches, then by path length
    results.sort_by(|a, b| {
        let a_exact = a.name.to_lowercase().contains(&query);
        let b_exact = b.name.to_lowercase().contains(&query);
        b_exact.cmp(&a_exact).then(a.path.len().cmp(&b.path.len()))
    });

    Ok(Json(results))
}

#[derive(Deserialize)]
struct ResizeMsg {
    cols: u16,
    rows: u16,
}

async fn ws_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mgr = state.manager.clone();
    // Auto-resume if detached
    {
        let mut mgr_lock = mgr.lock().await;
        let needs_resume = match mgr_lock.get(&id) {
            Some(conv) => conv.pty.is_none() || !conv.pty.as_ref().unwrap().is_alive(),
            None => return Err((StatusCode::NOT_FOUND, "not found".to_string())),
        };
        if needs_resume {
            let _ = mgr_lock.resume(&id);
        }
    }

    let mgr_lock = mgr.lock().await;
    let conv = mgr_lock
        .get(&id)
        .ok_or((StatusCode::NOT_FOUND, "not found".to_string()))?;
    let pty = conv.pty.as_ref()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "pty not available".to_string()))?;
    let rx = pty.tx.subscribe();
    let writer = pty.writer_handle();
    drop(mgr_lock);

    let mgr_for_ws = mgr.clone();
    Ok(ws.on_upgrade(move |socket| handle_ws(socket, writer, mgr_for_ws, id, rx)))
}

async fn handle_ws(
    socket: WebSocket,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    mgr: SharedManager,
    id: Uuid,
    mut rx: tokio::sync::broadcast::Receiver<Vec<u8>>,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Task: PTY raw output → WebSocket binary
    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(data) => {
                    if ws_tx.send(Message::Binary(data.into())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!("broadcast lagged, skipped {n} messages");
                    continue;
                }
                Err(RecvError::Closed) => break,
            }
        }
    });

    // Task: WebSocket input → PTY stdin
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                // Check for resize control message
                if let Some(json) = text.strip_prefix("\x1b[RESIZE]") {
                    if let Ok(resize) = serde_json::from_str::<ResizeMsg>(json) {
                        let mgr = mgr.lock().await;
                        if let Some(conv) = mgr.get(&id) {
                            if let Some(pty) = &conv.pty {
                            let _ = pty.resize(resize.cols, resize.rows);
                        }
                        }
                    }
                    continue;
                }
                let mut w = writer.lock().unwrap();
                let _ = w.write_all(text.as_bytes());
                let _ = w.flush();
            }
            Message::Binary(data) => {
                let mut w = writer.lock().unwrap();
                let _ = w.write_all(&data);
                let _ = w.flush();
            }
            _ => {}
        }
    }

    send_task.abort();
}


