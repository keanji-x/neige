//! `/api/waves`, `/api/coves/:id/waves` — Wave CRUD. **Owned by Track B.**

use crate::error::Result;
use crate::model::{NewWave, Wave, WaveDetail, WavePatch};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/waves", axum::routing::post(create))
        .route(
            "/api/waves/{id}",
            get(detail).patch(update).delete(delete_),
        )
        .route("/api/coves/{cove_id}/waves", get(list_by_cove))
}

async fn list_by_cove(
    State(s): State<AppState>,
    Path(cove_id): Path<String>,
) -> Result<Json<Vec<Wave>>> {
    let _ = (s, cove_id);
    todo!("track B")
}

async fn detail(State(s): State<AppState>, Path(id): Path<String>) -> Result<Json<WaveDetail>> {
    let _ = (s, id);
    todo!("track B: wave_detail; NotFound → 404")
}

async fn create(
    State(s): State<AppState>,
    Json(p): Json<NewWave>,
) -> Result<(StatusCode, Json<Wave>)> {
    let _ = (s, p);
    todo!("track B: wave_create + emit Event::WaveUpdated")
}

async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<WavePatch>,
) -> Result<Json<Wave>> {
    let _ = (s, id, p);
    todo!("track B")
}

async fn delete_(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    let _ = (s, id);
    todo!("track B: wave_delete + emit Event::WaveDeleted")
}

// keep `patch` import live for clarity
#[allow(dead_code)]
fn _patch_marker() -> axum::routing::MethodRouter<AppState> {
    patch(update)
}
