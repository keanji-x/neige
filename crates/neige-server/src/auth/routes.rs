use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::Duration;
use serde::Deserialize;
use serde_json::json;

use crate::auth::middleware::{AuthConfig, SESSION_COOKIE};
use crate::auth::token::verify_token;

const LOGIN_HTML: &str = include_str!("login.html");

pub async fn login_page() -> Html<&'static str> {
    Html(LOGIN_HTML)
}

#[derive(Deserialize)]
pub struct LoginBody {
    pub token: String,
}

pub async fn login_submit(
    State(cfg): State<AuthConfig>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    jar: CookieJar,
    Json(body): Json<LoginBody>,
) -> Response {
    // Rate limit by peer IP.
    if !cfg.rate_limiter.check(peer.ip()) {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limited").into_response();
    }

    let Some(stored) = cfg.token_hash.as_deref() else {
        // Auth disabled: accept without creating session (client shouldn't be here).
        return StatusCode::NO_CONTENT.into_response();
    };

    if !verify_token(&body.token, stored) {
        return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
    }

    let sid = cfg.sessions.create(Duration::days(30));
    let cookie = Cookie::build((SESSION_COOKIE, sid.to_string()))
        .http_only(true)
        .same_site(SameSite::Strict)
        .path("/")
        .max_age(time::Duration::days(30))
        .build();
    let jar = jar.add(cookie);
    let _ = peer; // peer already consumed for rate limiting
    (StatusCode::NO_CONTENT, jar).into_response()
}

pub async fn logout(State(cfg): State<AuthConfig>, jar: CookieJar) -> Response {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        if let Ok(id) = uuid::Uuid::parse_str(c.value()) {
            cfg.sessions.revoke(&id);
        }
    }
    let jar = jar.remove(Cookie::from(SESSION_COOKIE));
    (StatusCode::NO_CONTENT, jar).into_response()
}

pub async fn whoami(State(cfg): State<AuthConfig>, jar: CookieJar) -> Response {
    if !cfg.enabled() {
        return Json(json!({"authenticated": true, "disabled": true})).into_response();
    }
    if let Some(c) = jar.get(SESSION_COOKIE) {
        if let Ok(id) = uuid::Uuid::parse_str(c.value()) {
            if cfg.sessions.valid(&id) {
                return Json(json!({"authenticated": true})).into_response();
            }
        }
    }
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"authenticated": false})),
    )
        .into_response()
}
