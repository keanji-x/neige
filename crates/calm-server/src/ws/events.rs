//! `GET /api/events` (WebSocket upgrade). **Owned by Track C.**
//!
//! ## Protocol
//!
//! ### Client → server (text frame, JSON)
//!
//! ```json
//! { "sub": ["wave:w-001", "cove:c-001", "plugin:*"] }
//! ```
//!
//! Replaces the subscription set. Send `{"sub": ["*"]}` for firehose
//! (debug only). An empty array means "subscribe to nothing" — the server
//! keeps the connection open but forwards no events.
//!
//! ### Server → client (text frame, JSON)
//!
//! Each event is the `Event` enum serialized:
//!
//! ```json
//! { "ev": "wave.updated", "data": { "id":"w-001", ... } }
//! ```
//!
//! Forwarded only if `event::topics(ev)` intersects the client's `sub` set.
//!
//! ### Implementation hints
//!
//!   * `state.events.subscribe()` gives you a `broadcast::Receiver<Event>`.
//!   * On `Lagged(n)`: log + close. Client should reconnect + refetch.
//!   * Keep the subscription set in a local `HashSet<String>` per connection.

use crate::state::AppState;
use axum::{
    Router,
    extract::{
        State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
    routing::get,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/api/events", get(upgrade))
}

async fn upgrade(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle(socket, s))
}

async fn handle(socket: WebSocket, state: AppState) {
    let _ = (socket, state);
    // TODO(track C): subscription loop. See module docs.
}
