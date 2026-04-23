use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use uuid::Uuid;

use super::AppState;
use crate::conversation::CreateConvRequest;

#[derive(Deserialize)]
pub(super) struct PatchConvRequest {
    title: Option<String>,
}

pub(super) async fn list_convs(State(state): State<AppState>) -> impl IntoResponse {
    let mgr = state.manager.lock().await;
    Json(mgr.list())
}

pub(super) async fn create_conv(
    State(state): State<AppState>,
    Json(req): Json<CreateConvRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut mgr = state.manager.lock().await;
    let info = mgr
        .create(req)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok((StatusCode::CREATED, Json(info)))
}

pub(super) async fn delete_conv(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    let mut mgr = state.manager.lock().await;
    mgr.remove(&id).await;
    StatusCode::NO_CONTENT
}

pub(super) async fn patch_conv(
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

pub(super) async fn resume_conv(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut mgr = state.manager.lock().await;
    let info = mgr
        .resume(&id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(info))
}
