//! `/api/plugins` — plugin install/list/configure. **M2 territory.**
//!
//! Stubbed to 501 for now so the surface is wire-compatible from day 1.

use crate::error::{CalmError, Result};
use crate::model::Plugin;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::State,
    routing::get,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/api/plugins", get(list))
}

async fn list(State(s): State<AppState>) -> Result<Json<Vec<Plugin>>> {
    // OK to call repo for now — MockRepo returns [].
    Ok(Json(s.repo.plugins_list().await?))
}

#[allow(dead_code)]
fn _placeholder() -> CalmError {
    CalmError::Internal("plugins endpoint not yet implemented".into())
}
