use std::time::Duration;

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

/// Server-initiated WS ping cadence. Browsers auto-reply with Pong (we don't
/// see it in JS), and the send itself fails fast if TCP is broken — catches
/// idle-timeout closures from intermediaries (mobile NAT, proxies) and
/// half-open connections without needing kernel TCP keepalive.
const WS_PING_INTERVAL: Duration = Duration::from_secs(30);

/// WS-facing control messages the browser client sends as JSON text frames.
/// This is a distinct type from `neige_session::ClientMsg`, which is the
/// daemon-facing protocol.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum WsClientMsg {
    /// Sent as the first frame after the WebSocket opens. `last_seq` is the
    /// highest chunk seq the client still has in its xterm buffer; null for a
    /// fresh attach. `attach_id` is what the client received from a previous
    /// `hello.attach_id` (null for a never-attached client). If it doesn't
    /// match the current SessionClient's id, the seq numbering belongs to a
    /// different epoch and we discard `last_seq` to force a Snapshot.
    /// Server responds with Delta / Snapshot / hello depending on how far
    /// behind the client is.
    Attach {
        last_seq: Option<u64>,
        attach_id: Option<Uuid>,
    },
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
    let mut claimed_attach_id: Option<Uuid> = None;

    match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => match serde_json::from_str::<WsClientMsg>(&text) {
            Ok(WsClientMsg::Attach {
                last_seq: ls,
                attach_id,
            }) => {
                last_seq = ls;
                claimed_attach_id = attach_id;
            }
            Ok(WsClientMsg::Resize { cols, rows }) => {
                apply_resize(&mgr, &id, cols, rows).await;
            }
            Err(_) => return,
        },
        Some(Ok(_)) | Some(Err(_)) | None => return,
    }

    // Pull the attach payload + live receiver atomically.
    let (mut rx, attach_result, attach_id) = {
        let mgr_lock = mgr.lock().await;
        let Some(conv) = mgr_lock.get(&id) else {
            return;
        };
        let Some(client) = conv.client.as_ref() else {
            return;
        };
        let (rx, result) = client.attach(last_seq, claimed_attach_id);
        (rx, result, client.attach_id())
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

    // Hello tells the client what seq to treat as its new baseline, and what
    // epoch identifier to echo back on its next reconnect.
    let hello = serde_json::json!({
        "type": "hello",
        "last_seq": baseline_seq,
        "attach_id": attach_id.to_string(),
    });
    if ws_tx
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    // Live forwarding task. Multiplexes between the broadcast (live PTY
    // output) and a periodic Ping (heartbeat for half-open detection).
    let send_task = tokio::spawn(async move {
        // First fire is at +WS_PING_INTERVAL, not immediately. Using
        // `interval_at` rather than `interval().tick().await` to drop the
        // first tick — explicit so a later refactor doesn't accidentally
        // resurrect the immediate Ping by changing the construction.
        let mut ping = tokio::time::interval_at(
            tokio::time::Instant::now() + WS_PING_INTERVAL,
            WS_PING_INTERVAL,
        );
        ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                res = rx.recv() => match res {
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
                    }
                    Err(RecvError::Closed) => break,
                },
                _ = ping.tick() => {
                    if ws_tx.send(Message::Ping(Vec::new().into())).await.is_err() {
                        break;
                    }
                }
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
/// handshake. Text frames are JSON control messages (resize / re-attach);
/// binary frames are stdin. Unparseable text is logged and dropped — the
/// previous "treat unknown text as stdin" fallback made any typo'd control
/// frame silently end up in the PTY, and any keystroke happening to start
/// with `{"` would be misinterpreted as a control frame.
async fn process_inbound(
    msg: Message,
    mgr: &SharedManager,
    id: &Uuid,
    sender: &UnboundedSender<ClientMsg>,
) {
    match msg {
        Message::Text(text) => match serde_json::from_str::<WsClientMsg>(&text) {
            Ok(WsClientMsg::Resize { cols, rows }) => {
                apply_resize(mgr, id, cols, rows).await;
            }
            // A second Attach frame is a no-op; client shouldn't send one.
            Ok(WsClientMsg::Attach { .. }) => {}
            Err(e) => {
                tracing::warn!(error = %e, "unparseable WS text frame; dropping");
            }
        },
        Message::Binary(data) => {
            let _ = sender.send(ClientMsg::Stdin(data.to_vec()));
        }
        _ => {}
    }
}
