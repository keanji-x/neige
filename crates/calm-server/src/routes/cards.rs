//! `/api/cards`, `/api/waves/:id/cards` — Card CRUD. **Owned by Track B.**

use crate::error::{CalmError, Result};
use crate::event::Event;
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
    let cards = s.repo.cards_by_wave(&wave_id).await?;
    Ok(Json(cards))
}

async fn create(
    State(s): State<AppState>,
    Path(wave_id): Path<String>,
    Json(mut p): Json<NewCard>,
) -> Result<(StatusCode, Json<Card>)> {
    // Path is the source of truth — overwrite anything the body claims so a
    // misrouted body can't slip a card into the wrong wave.
    p.wave_id = wave_id;
    let card = s.repo.card_create(p).await?;
    s.events.emit(Event::CardAdded(card.clone()));
    Ok((StatusCode::CREATED, Json(card)))
}

async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<CardPatch>,
) -> Result<Json<Card>> {
    let card = s.repo.card_update(&id, p).await?;
    s.events.emit(Event::CardUpdated(card.clone()));
    Ok(Json(card))
}

async fn delete_(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    // Look up first so we have the wave_id for the delete event.
    let card = s
        .repo
        .card_get(&id)
        .await?
        .ok_or_else(|| CalmError::NotFound(format!("card {id}")))?;
    s.repo.card_delete(&id).await?;
    s.events.emit(Event::CardDeleted {
        id: card.id,
        wave_id: card.wave_id,
    });
    Ok(StatusCode::NO_CONTENT)
}
