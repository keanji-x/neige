//! `/api/cards`, `/api/waves/:id/cards` — Card CRUD. **Owned by Track B.**

use crate::error::Result;
use crate::model::{Card, CardPatch, NewCard};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::get,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/waves/{wave_id}/cards", get(list_by_wave).post(create))
        .route(
            "/api/cards/{id}",
            axum::routing::patch(update).delete(delete_),
        )
}

async fn list_by_wave(
    State(s): State<AppState>,
    Path(wave_id): Path<String>,
) -> Result<Json<Vec<Card>>> {
    let _ = (s, wave_id);
    todo!("track B")
}

async fn create(
    State(s): State<AppState>,
    Path(wave_id): Path<String>,
    Json(mut p): Json<NewCard>,
) -> Result<(StatusCode, Json<Card>)> {
    let _ = (s, &wave_id, &mut p);
    // Hint: enforce p.wave_id == wave_id (or fill it in from the path).
    todo!("track B: card_create + emit Event::CardAdded")
}

async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<CardPatch>,
) -> Result<Json<Card>> {
    let _ = (s, id, p);
    todo!("track B")
}

async fn delete_(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    let _ = (s, id);
    todo!("track B")
}
