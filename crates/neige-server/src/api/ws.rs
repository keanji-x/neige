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
use crate::attach::AttachResult;
use crate::conversation::SharedManager;

/// WS-facing control messages the browser client sends as JSON text frames.
/// This is a distinct type from `neige_session::ClientMsg`, which is the
/// daemon-facing protocol.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum WsClientMsg {
    /// Sent as the first frame after the WebSocket opens. `last_seq` is the
    /// highest chunk seq the client still has in its xterm buffer; null for a
    /// fresh attach. Server responds with Delta / Snapshot / hello depending
    /// on how far behind the client is.
    Attach { last_seq: Option<u64> },
    /// PTY dimensions, delivered as a first-class control message.
    Resize { cols: u16, rows: u16 },
}

/// Framed PTY output, sent as a WebSocket Binary frame:
///   [u64 big-endian seq][payload bytes]
/// A `seq == 0` payload is the "snapshot / redraw" marker: client should call
/// `term.reset()` before writing the payload. Real chunks start at seq = 1.
fn frame(seq: u64, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + payload.len());
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(payload);
    out
}

async fn apply_resize(mgr: &SharedManager, id: &Uuid, cols: u16, rows: u16) {
    let m = mgr.lock().await;
    if let Some(conv) = m.get(id) {
        if let Some(client) = &conv.client {
            let _ = client.resize(cols, rows);
        }
    }
}

pub(super) async fn ws_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mgr = state.manager.clone();
    // Auto-resume if detached
    {
        let mut mgr_lock = mgr.lock().await;
        let needs_resume = match mgr_lock.get(&id) {
            Some(conv) => conv.client.is_none() || !conv.client.as_ref().unwrap().is_alive(),
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
        .client
        .as_ref()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "session client not available".to_string()))?;
    let sender = client.stdin_sender();
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

    // Wait for the client's first frame. Clients MUST send an Attach JSON text
    // frame first; anything else is treated as a protocol error and the
    // connection closes.
    let mut last_seq: Option<u64> = None;

    match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => match serde_json::from_str::<WsClientMsg>(&text) {
            Ok(WsClientMsg::Attach { last_seq: ls }) => last_seq = ls,
            Ok(WsClientMsg::Resize { cols, rows }) => {
                apply_resize(&mgr, &id, cols, rows).await;
            }
            Err(_) => return,
        },
        Some(Ok(_)) | Some(Err(_)) | None => return,
    }

    // Pull the attach payload + live receiver atomically.
    let (mut rx, attach_result) = {
        let mgr_lock = mgr.lock().await;
        let Some(conv) = mgr_lock.get(&id) else {
            return;
        };
        let Some(client) = conv.client.as_ref() else {
            return;
        };
        client.attach(last_seq)
    };

    // Prime the client.
    let baseline_seq = match attach_result {
        AttachResult::UpToDate { latest_seq } => latest_seq,
        AttachResult::Delta { chunks, latest_seq } => {
            for (seq, bytes) in chunks {
                if ws_tx
                    .send(Message::Binary(frame(seq, &bytes).into()))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            latest_seq
        }
        AttachResult::Snapshot { bytes, latest_seq } => {
            // seq=0 = "reset then write this payload".
            if ws_tx
                .send(Message::Binary(frame(0, &bytes).into()))
                .await
                .is_err()
            {
                return;
            }
            latest_seq
        }
    };

    // Hello tells the client what seq to treat as its new baseline.
    let hello = serde_json::json!({ "type": "hello", "last_seq": baseline_seq });
    if ws_tx
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    // Live forwarding task — writes every new (seq, bytes) tuple as a framed
    // binary frame.
    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok((seq, data)) => {
                    if ws_tx
                        .send(Message::Binary(frame(seq, &data).into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!("broadcast lagged, skipped {n} messages");
                    continue;
                }
                Err(RecvError::Closed) => break,
            }
        }
    });

    let handle_inbound = async {
        while let Some(Ok(msg)) = ws_rx.next().await {
            process_inbound(msg, &mgr, &id, &sender).await;
        }
    };
    handle_inbound.await;

    send_task.abort();
}

/// One-shot dispatch for an inbound WebSocket message after the attach
/// handshake. JSON control frames (resize) are dispatched to the daemon via
/// `apply_resize`; binary frames are forwarded as `ClientMsg::Stdin`.
async fn process_inbound(
    msg: Message,
    mgr: &SharedManager,
    id: &Uuid,
    sender: &UnboundedSender<ClientMsg>,
) {
    match msg {
        Message::Text(text) => {
            match serde_json::from_str::<WsClientMsg>(&text) {
                Ok(WsClientMsg::Resize { cols, rows }) => {
                    apply_resize(mgr, id, cols, rows).await;
                }
                // A second Attach frame is a no-op; client shouldn't send one.
                Ok(WsClientMsg::Attach { .. }) => {}
                Err(_) => {}
            }
        }
        Message::Binary(data) => {
            let _ = sender.send(ClientMsg::Stdin(data.to_vec()));
        }
        _ => {}
    }
}
