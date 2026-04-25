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
    // Preserve original path (with query) so /login can bounce back after
    // sign-in. Stops the user from being dumped onto the desktop UI when
    // they originally asked for /m/.
    Redirect::to(&login_redirect_target(&path, req.uri().query())).into_response()
}

/// `/login?next=<percent-encoded original path-and-query>`. Pure helper so
/// the redirect target is testable without spinning up an axum router.
pub fn login_redirect_target(path: &str, query: Option<&str>) -> String {
    let original = match query {
        Some(q) if !q.is_empty() => format!("{path}?{q}"),
        _ => path.to_string(),
    };
    let encoded: String = url::form_urlencoded::byte_serialize(original.as_bytes()).collect();
    format!("/login?next={encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_param_preserves_simple_path() {
        assert_eq!(login_redirect_target("/m/", None), "/login?next=%2Fm%2F");
        assert_eq!(login_redirect_target("/", None), "/login?next=%2F");
    }

    #[test]
    fn next_param_includes_query() {
        assert_eq!(
            login_redirect_target("/api/conversations", Some("limit=10")),
            "/login?next=%2Fapi%2Fconversations%3Flimit%3D10"
        );
    }

    #[test]
    fn next_param_handles_unicode_and_special_chars() {
        // Percent-encoded so the next-hop URL parser can't be confused by
        // an embedded `?` or `&` in the original path.
        let target = login_redirect_target("/m/foo&bar?x=1", Some("y=2"));
        assert!(target.starts_with("/login?next="));
        // Decoding back must yield the original.
        let next = target.strip_prefix("/login?next=").unwrap();
        let decoded: String = url::form_urlencoded::parse(format!("k={next}").as_bytes())
            .next()
            .unwrap()
            .1
            .into_owned();
        assert_eq!(decoded, "/m/foo&bar?x=1?y=2");
    }

    #[test]
    fn next_param_empty_query_doesnt_add_separator() {
        assert_eq!(
            login_redirect_target("/m/", Some("")),
            "/login?next=%2Fm%2F"
        );
    }

    #[test]
    fn is_public_path_covers_login_and_health() {
        assert!(is_public_path("/login"));
        assert!(is_public_path("/login/submit"));
        assert!(is_public_path("/favicon.ico"));
        assert!(is_public_path("/api/healthz"));
        assert!(!is_public_path("/api/conversations"));
        assert!(!is_public_path("/m/"));
        assert!(!is_public_path("/"));
    }
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
