use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Redirect, Response},
};
use axum_extra::extract::cookie::CookieJar;
use uuid::Uuid;

use crate::auth::origin::{is_allowed_origin, origin_from_referer};
use crate::auth::store::{LoginRateLimiter, SessionStore};
use crate::auth::token::verify_token;

pub const SESSION_COOKIE: &str = "neige_session";

#[derive(Clone)]
pub struct AuthConfig {
    pub sessions: Arc<SessionStore>,
    pub rate_limiter: Arc<LoginRateLimiter>,
    /// Hashed token; `None` means auth disabled (`--no-auth`).
    pub token_hash: Option<String>,
    pub allowed_origins: Vec<String>,
}

impl AuthConfig {
    pub fn enabled(&self) -> bool {
        self.token_hash.is_some()
    }
}

fn is_public_path(path: &str) -> bool {
    matches!(
        path,
        "/login" | "/login/submit" | "/favicon.ico" | "/api/healthz"
    )
}

pub async fn auth_middleware(
    State(cfg): State<AuthConfig>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();

    if is_public_path(&path) {
        return next.run(req).await;
    }

    if !cfg.enabled() {
        return next.run(req).await;
    }

    let headers = req.headers();
    let jar = CookieJar::from_headers(headers);

    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        if let Ok(id) = Uuid::parse_str(cookie.value()) {
            if cfg.sessions.valid(&id) {
                return next.run(req).await;
            }
        }
    }

    if let Some(tok_hash) = cfg.token_hash.as_deref() {
        if let Some(auth_h) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
            if let Some(tok) = auth_h.strip_prefix("Bearer ") {
                if verify_token(tok, tok_hash) {
                    return next.run(req).await;
                }
            }
        }
    }

    if path.starts_with("/api/") || path.starts_with("/ws/") {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    Redirect::to("/login").into_response()
}

pub async fn origin_check_middleware(
    State(cfg): State<AuthConfig>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    let is_ws = path.starts_with("/ws/");
    let is_state_change = matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE");

    if !is_ws && !is_state_change {
        return next.run(req).await;
    }

    if !cfg.enabled() {
        return next.run(req).await;
    }

    let headers = req.headers();
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());

    if let Some(o) = origin {
        if is_allowed_origin(o, &cfg.allowed_origins) {
            return next.run(req).await;
        }
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }

    // Origin missing
    if is_ws {
        return (StatusCode::FORBIDDEN, "origin required for websocket").into_response();
    }

    // State-changing HTTP without Origin: fall back to Referer
    if let Some(r) = headers.get(header::REFERER).and_then(|v| v.to_str().ok()) {
        if let Some(o) = origin_from_referer(r) {
            if is_allowed_origin(&o, &cfg.allowed_origins) {
                return next.run(req).await;
            }
        }
    }
    (StatusCode::FORBIDDEN, "origin missing and referer not trusted").into_response()
}
