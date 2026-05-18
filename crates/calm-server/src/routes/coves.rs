//! `/api/coves` — Cove CRUD. **Owned by Track B.**
//!
//! After each successful mutation, emit the matching `Event` via
//! `state.events.emit(...)` so the WS bus can fan out.

use crate::error::{CalmError, Result};
use crate::event::Event;
use crate::model::{Cove, CovePatch, NewCove};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::get,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/coves", get(list).post(create))
        .route(
            "/api/coves/{id}",
            axum::routing::patch(update).delete(delete_),
        )
}

async fn list(State(s): State<AppState>) -> Result<Json<Vec<Cove>>> {
    let _ = s;
    todo!("track B: s.repo.coves_list()")
}

async fn create(
    State(s): State<AppState>,
    Json(p): Json<NewCove>,
) -> Result<(StatusCode, Json<Cove>)> {
    let _ = (s, p);
    todo!("track B: create + emit Event::CoveUpdated, return (201, cove)")
}

async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<CovePatch>,
) -> Result<Json<Cove>> {
    let _ = (s, id, p);
    todo!("track B: update + emit Event::CoveUpdated")
}

async fn delete_(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    let _ = (s, id);
    todo!("track B: delete + emit Event::CoveDeleted, return 204")
}

#[allow(dead_code)]
fn _suppress() -> CalmError {
    CalmError::Internal(format!("{:?}", Event::CoveDeleted { id: String::new() }))
}
