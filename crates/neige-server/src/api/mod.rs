use axum::{
    Router,
    routing::{delete, get, post},
};

use crate::auth::AuthConfig;
use crate::conversation::SharedManager;

mod chat_ws;
mod config;
mod conversations;
mod fs;
mod proxy;
mod util;
mod ws;

#[derive(Clone)]
pub struct AppState {
    pub manager: SharedManager,
    pub auth: AuthConfig,
}

impl axum::extract::FromRef<AppState> for AuthConfig {
    fn from_ref(s: &AppState) -> Self {
        s.auth.clone()
    }
}

async fn healthz() -> &'static str {
    "ok"
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/healthz", get(healthz))
        .route("/api/conversations", get(conversations::list_convs))
        .route("/api/conversations", post(conversations::create_conv))
        .route("/api/browse", get(fs::browse_dir))
        .route("/api/is-git-repo", get(fs::check_is_git_repo))
        .route("/api/file", get(fs::read_file).head(fs::head_file))
        .route("/api/files", get(fs::search_files))
        .route("/api/conversations/{id}", delete(conversations::delete_conv))
        .route(
            "/api/conversations/{id}",
            axum::routing::patch(conversations::patch_conv),
        )
        .route(
            "/api/conversations/{id}/resume",
            post(conversations::resume_conv),
        )
        .route("/api/config", get(config::get_config))
        .route("/api/config", post(config::save_config))
        .route("/api/layout", get(config::get_layout))
        .route("/api/layout", post(config::save_layout))
        .route("/api/proxy", get(proxy::proxy_request))
        .route("/ws/{id}", get(ws::ws_handler))
        .route("/ws/{id}/chat", get(chat_ws::chat_ws_handler))
}
