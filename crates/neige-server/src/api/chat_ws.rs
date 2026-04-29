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
//! - Stop / interrupt the current generation:
//!   ```json
//!   {"type":"stop"}
//!   ```
//!   Forwarded as `ClientMsg::ChatStop`; the chat runner asks the Claude
//!   SDK to interrupt the in-flight turn.
//!
//! ### Server → client
//!
//! - **Replay / live events**: a seq envelope wrapping the NeigeEvent:
//!   ```json
//!   {"seq":<u64>,"event":<NeigeEvent>}
//!   ```
//!   The seq is monotonic over the session and is what the client echoes
//!   back as `last_seq` on a reattach. The wrapped event is the same JSON
//!   the daemon emitted on stdout (`session_init`, `assistant_text_delta`,
//!   etc — discriminated by its own `"type"` field).
//!
//! - **Control envelope** (only one shape): `{"type":"hello","last_seq":<n>}`
//!   sent once after replay. Distinguishable from event envelopes because
//!   event envelopes carry `seq` + `event`; hello carries `type:"hello"`.
//!
//! Snapshot priming: a brand-new client attaches with `last_seq: null` and
//! receives every buffered event in order, then `hello`. Re-attaching
//! clients send their last seq and only receive the delta (or a full
//! snapshot if the daemon's ring buffer rolled over).

use std::collections::HashMap;

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

use super::{AppState, PendingQuestions};
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
    /// Interrupt the current claude generation. Forwarded as
    /// `ClientMsg::ChatStop`; the runner calls the SDK interrupt API.
    Stop,
    /// User answered a chat dialog. We first look up the matching MCP
    /// `ask_question` oneshot in `pending_questions`; if none exists, the
    /// answer is forwarded to the runner for an SDK AskUserQuestion prompt.
    /// Unknown question_id is silently dropped — the dialog might have
    /// expired (server restart purges the registry).
    AnswerQuestion {
        question_id: Uuid,
        answers: HashMap<String, String>,
    },
}

/// Wrap a pre-serialized NeigeEvent JSON in `{"seq":N,"event":<json>}`.
/// String-formatted rather than going through serde_json::Value so we don't
/// re-parse every event on the broadcast hot path.
fn seq_envelope(seq: u64, event_json: &str) -> String {
    format!(r#"{{"seq":{seq},"event":{event_json}}}"#)
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
                conv.chat_client.is_none() || !conv.chat_client.as_ref().unwrap().is_alive()
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
    let client = conv.chat_client.as_ref().ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        "chat client not available".to_string(),
    ))?;
    let sender = client.ctrl_sender();
    drop(mgr_lock);

    let mgr_for_ws = mgr.clone();
    let pending = state.pending_questions.clone();
    Ok(ws.on_upgrade(move |socket| handle_ws(socket, sender, mgr_for_ws, id, pending)))
}

async fn handle_ws(
    socket: WebSocket,
    sender: UnboundedSender<ClientMsg>,
    mgr: SharedManager,
    id: Uuid,
    pending: PendingQuestions,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // First frame must be Attach.
    let last_seq: Option<u64> = match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => match serde_json::from_str::<WsClientMsg>(&text) {
            Ok(WsClientMsg::Attach { last_seq: ls }) => ls,
            // A leading data frame before attach is a protocol violation;
            // close politely. AnswerQuestion is included so a stale tab
            // resuming after dialog timeout doesn't get treated as Attach.
            Ok(_) => return,
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
            for (seq, json) in events {
                if ws_tx
                    .send(Message::Text(seq_envelope(seq, &json).into()))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            latest_seq
        }
        AttachResult::Snapshot { events, latest_seq } => {
            for (seq, json) in events {
                if ws_tx
                    .send(Message::Text(seq_envelope(seq, &json).into()))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            latest_seq
        }
    };

    // Hello tells the client what seq to treat as its new baseline. Event
    // envelopes carry a `seq` + `event` pair; the hello envelope uses
    // `type:"hello"` so the frontend can branch on shape.
    let hello = serde_json::json!({ "type": "hello", "last_seq": baseline_seq });
    if ws_tx
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    // Live forwarding: every incoming (seq, json) → one Text frame, wrapped
    // in the same seq envelope so the client can keep its lastSeq fresh and
    // request a Delta on reconnect.
    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok((seq, json)) => {
                    if ws_tx
                        .send(Message::Text(seq_envelope(seq, &json).into()))
                        .await
                        .is_err()
                    {
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
                    Ok(WsClientMsg::Stop) => {
                        let _ = sender.send(ClientMsg::ChatStop);
                    }
                    Ok(WsClientMsg::Attach { .. }) => {
                        // A second attach on a live connection is a no-op.
                    }
                    Ok(WsClientMsg::AnswerQuestion {
                        question_id,
                        answers,
                    }) => {
                        // Dispatch order: in-Rust `pending_questions`
                        // registry takes priority. The MCP `ask_question`
                        // tool registers a oneshot keyed by
                        // (session_id, question_id) when an inner claude
                        // self-asks; resolving that oneshot wakes the
                        // tool call up with the user's answer.
                        //
                        // If no oneshot matches, the question must have
                        // come from the runner's canUseTool callback (the
                        // sidecar's AskUserQuestion replacement). Forward
                        // the answer to the daemon, which relays it to the
                        // runner so the in-flight tool call can resolve.
                        // Unknown-to-both ids fall through and the runner
                        // logs a debug; this is fine because dialogs that
                        // expire on either side are best-effort.
                        let taken = {
                            let mut pending_lock = pending.lock().await;
                            pending_lock.remove(&(id, question_id))
                        };
                        match taken {
                            Some(tx) => {
                                // Best-effort: receiver may have been dropped
                                // (tool call timed out or was cancelled).
                                let _ = tx.send(answers);
                            }
                            None => {
                                let _ = sender.send(ClientMsg::AnswerQuestion {
                                    question_id,
                                    answers,
                                });
                            }
                        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_client_msg_stop_parses() {
        let parsed: WsClientMsg = serde_json::from_str(r#"{"type":"stop"}"#).unwrap();
        assert!(matches!(parsed, WsClientMsg::Stop));
    }

    #[test]
    fn ws_client_msg_answer_question_parses() {
        // Locks the wire shape that the frontend sends for the
        // ask_user_question dialog. snake_case discriminator + question_id
        // + answers map; if any of these names drift the dialog silently fails.
        let raw = r#"{"type":"answer_question","question_id":"00000000-0000-0000-0000-000000000001","answers":{"Proceed?":"yes"}}"#;
        let parsed: WsClientMsg = serde_json::from_str(raw).unwrap();
        match parsed {
            WsClientMsg::AnswerQuestion {
                question_id,
                answers,
            } => {
                assert_eq!(
                    question_id,
                    Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap()
                );
                assert_eq!(
                    answers.get("Proceed?").map(String::as_str),
                    Some("yes")
                );
            }
            _ => panic!("expected AnswerQuestion variant"),
        }
    }

    #[test]
    fn seq_envelope_parses_round_trip() {
        // Sanity-check the string-formatted envelope: it must be valid JSON
        // with seq + the original event nested intact under `event`.
        let inner = r#"{"type":"assistant_text_delta","session_id":"abc","text":"hi"}"#;
        let wrapped = seq_envelope(7, inner);
        let v: serde_json::Value = serde_json::from_str(&wrapped).unwrap();
        assert_eq!(v["seq"], 7);
        assert_eq!(v["event"]["type"], "assistant_text_delta");
        assert_eq!(v["event"]["session_id"], "abc");
        assert_eq!(v["event"]["text"], "hi");
    }
}
