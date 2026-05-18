//! `GET /api/terminals/:id` (WebSocket upgrade). **Owned by Track D.**
//!
//! ## Protocol
//!
//! Identical to existing neige-server's terminal WS — frames carry the
//! `neige_session::ClientMsg` / `DaemonMsg` enums encoded as JSON text:
//!
//!   client → server:  `{"Attach":{"cols":80,"rows":24}}`
//!                     `{"Stdin":[...]}`
//!                     `{"Resize":{"cols":..,"rows":..}}`
//!                     `"Kill"`
//!   server → client:  `{"Hello":{"replay":[...]}}`
//!                     `{"Stdout":[...]}`
//!                     `{"ChildExited":{"code":0}}`
//!
//! Track D plumbs this through to `state.daemon` (the unix-socket client
//! pool for `neige-session-daemon`).

use crate::state::AppState;
use axum::{
    Router,
    extract::{
        Path, State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
    routing::get,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/api/terminals/{id}", get(upgrade))
}

async fn upgrade(
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle(socket, id, s))
}

async fn handle(socket: WebSocket, terminal_id: String, state: AppState) {
    let _ = (socket, terminal_id, state);
    // TODO(track D): bridge to neige-session-daemon for `terminal_id`.
}
