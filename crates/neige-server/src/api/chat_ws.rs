//! WebSocket endpoint `/ws/{id}/chat` for Mode B (chat / stream-json) sessions.
//!
//! ## Wire contract (frontend ↔ server)
//!
//! All frames are **text** (JSON). No binary frames in chat mode.
//!
//! ### Client → server
//!
//! - First frame **must** be:
//!   ```json
//!   {"type":"attach","last_seq":<u64>|null}
//!   ```
//!   `last_seq` is the highest event seq the client has retained; null on
//!   fresh attach. Server replies with replay events (Delta / Snapshot)
//!   followed by a `hello` envelope.
//!
//! - User-message turns:
//!   ```json
//!   {"type":"user_message","content":"<string>"}
//!   ```
//!   Forwarded to the daemon as `ClientMsg::ChatUserMessage`. The daemon
//!   wraps it in the stream-json input envelope and writes to claude stdin.
//!
//! ### Server → client
//!
//! - **Replay / live events**: each is a NeigeEvent JSON, sent as-is. The
//!   discriminator is the event's own `"type"` field (`session_init`,
//!   `assistant_text_delta`, etc).
//!
//! - **Control envelope** (only one shape): `{"type":"hello","last_seq":<n>}`
//!   sent once after replay. Distinguishable from NeigeEvents because
//!   NeigeEvents always include a `session_id` field; the hello envelope
//!   does not.
//!
//! Snapshot priming: a brand-new client attaches with `last_seq: null` and
//! receives every buffered event in order, then `hello`. Re-attaching
//! clients send their last seq and only receive the delta (or a full
//! snapshot if the daemon's ring buffer rolled over).

use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use neige_session::ClientMsg;
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use super::AppState;
use crate::attach::chat::AttachResult;
use crate::conversation::SharedManager;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WsClientMsg {
    /// First frame after the WebSocket opens. `last_seq` is the highest
    /// event seq the client still holds; null for a fresh attach.
    Attach { last_seq: Option<u64> },
    /// User turn — daemon will wrap and forward to claude stdin.
    UserMessage { content: String },
}

pub(super) async fn chat_ws_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mgr = state.manager.clone();
    // Auto-resume if detached, like the terminal endpoint does.
    {
        let mut mgr_lock = mgr.lock().await;
        let needs_resume = match mgr_lock.get(&id) {
            Some(conv) => {
                conv.chat_client.is_none()
                    || !conv.chat_client.as_ref().unwrap().is_alive()
            }
            None => return Err((StatusCode::NOT_FOUND, "not found".to_string())),
        };
        if needs_resume {
            let _ = mgr_lock.resume(&id).await;
        }
    }

    let mgr_lock = mgr.lock().await;
    let conv = mgr_lock
        .get(&id)
        .ok_or((StatusCode::NOT_FOUND, "not found".to_string()))?;
    let client = conv
        .chat_client
        .as_ref()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "chat client not available".to_string()))?;
    let sender = client.ctrl_sender();
    drop(mgr_lock);

    let mgr_for_ws = mgr.clone();
    Ok(ws.on_upgrade(move |socket| handle_ws(socket, sender, mgr_for_ws, id)))
}

async fn handle_ws(
    socket: WebSocket,
    sender: UnboundedSender<ClientMsg>,
    mgr: SharedManager,
    id: Uuid,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // First frame must be Attach.
    let last_seq: Option<u64> = match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => match serde_json::from_str::<WsClientMsg>(&text) {
            Ok(WsClientMsg::Attach { last_seq: ls }) => ls,
            // A leading user_message before attach is a protocol violation;
            // close politely.
            Ok(WsClientMsg::UserMessage { .. }) => return,
            Err(_) => return,
        },
        Some(Ok(_)) | Some(Err(_)) | None => return,
    };

    // Pull replay payload + live receiver atomically.
    let (mut rx, attach_result) = {
        let mgr_lock = mgr.lock().await;
        let Some(conv) = mgr_lock.get(&id) else {
            return;
        };
        let Some(client) = conv.chat_client.as_ref() else {
            return;
        };
        client.attach(last_seq)
    };

    // Prime the client.
    let baseline_seq = match attach_result {
        AttachResult::UpToDate { latest_seq } => latest_seq,
        AttachResult::Delta { events, latest_seq } => {
            for (_, json) in events {
                if ws_tx.send(Message::Text(json.into())).await.is_err() {
                    return;
                }
            }
            latest_seq
        }
        AttachResult::Snapshot { events, latest_seq } => {
            for json in events {
                if ws_tx.send(Message::Text(json.into())).await.is_err() {
                    return;
                }
            }
            latest_seq
        }
    };

    // Hello tells the client what seq to treat as its new baseline. NeigeEvent
    // JSON always carries a `session_id`; the hello envelope deliberately
    // doesn't, so the frontend can branch on shape.
    let hello = serde_json::json!({ "type": "hello", "last_seq": baseline_seq });
    if ws_tx
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    // Live forwarding: every incoming (seq, json) → one Text frame.
    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok((_seq, json)) => {
                    if ws_tx.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!("chat broadcast lagged, skipped {n} messages");
                    continue;
                }
                Err(RecvError::Closed) => break,
            }
        }
    });

    let handle_inbound = async {
        while let Some(Ok(msg)) = ws_rx.next().await {
            if let Message::Text(text) = msg {
                match serde_json::from_str::<WsClientMsg>(&text) {
                    Ok(WsClientMsg::UserMessage { content }) => {
                        let _ = sender.send(ClientMsg::ChatUserMessage { content });
                    }
                    Ok(WsClientMsg::Attach { .. }) => {
                        // A second attach on a live connection is a no-op.
                    }
                    Err(e) => {
                        tracing::debug!(error = %e, "unparseable chat ws frame");
                    }
                }
            }
            // Ignore binary / ping / pong / close — chat mode is JSON-text only.
        }
    };
    handle_inbound.await;

    send_task.abort();
}
