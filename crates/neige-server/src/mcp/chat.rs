//! Chat-session helpers shared by the `send_message` and `answer_question`
//! tools.
//!
//! Both tools post a user-message frame to a chat daemon and aggregate the
//! resulting stream-json events into a single response payload. The logic
//! is mode-agnostic — it doesn't know which MCP tool invoked it — so it
//! lives outside the per-tool files.

use neige_session::ClientMsg;
use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::attach::chat::AttachResult;
use crate::conversation::SharedManager;

/// Post `content` as a user message to the chat session and block until
/// claude emits a `result` event closing the turn. Returns the aggregated
/// payload `{status, text, tool_calls, result, pending_question}`.
///
/// Auto-resumes if the session is detached. Never times out — long
/// human-in-the-loop turns are a feature, not a bug; the orchestrator
/// decides when to call `stop`.
pub async fn send_and_wait(
    mgr: SharedManager,
    session_id: Uuid,
    content: String,
) -> Result<Value, String> {
    // 1. Acquire (and resume if needed) the chat client. We pull rx +
    //    ctrl_sender + the seq baseline atomically so no events slip in
    //    between subscribe and the user-message send.
    let (mut rx, baseline_seq, ctrl_sender) = {
        let mut guard = mgr.lock().await;
        if guard.get(&session_id).is_none() {
            return Err("session not found".into());
        }
        let needs_resume = guard
            .get(&session_id)
            .and_then(|c| c.chat_client.as_ref())
            .map(|c| !c.is_alive())
            .unwrap_or(true);
        if needs_resume {
            guard.resume(&session_id).await?;
        }
        let conv = guard
            .get(&session_id)
            .ok_or_else(|| "session vanished after resume".to_string())?;
        let client = conv.chat_client.as_ref().ok_or_else(|| {
            "session is not in chat mode (terminal sessions can't be driven via MCP)".to_string()
        })?;
        let (rx, attach) = client.attach(None);
        // We only care about events emitted after this point. The history
        // returned by `attach` (via Snapshot/Delta) is all pre-existing
        // turns we should ignore.
        let baseline = match attach {
            AttachResult::UpToDate { latest_seq } => latest_seq,
            AttachResult::Delta { latest_seq, .. } => latest_seq,
            AttachResult::Snapshot { latest_seq, .. } => latest_seq,
        };
        (rx, baseline, client.ctrl_sender())
    };

    // 2. Post the user message.
    ctrl_sender
        .send(ClientMsg::ChatUserMessage { content })
        .map_err(|_| "daemon channel closed".to_string())?;

    // 3. Drain the broadcast until the next `result` envelope.
    let mut agg = TurnAggregator::default();
    let mut lagged_warned = false;

    loop {
        let (seq, json) = match rx.recv().await {
            Ok(pair) => pair,
            Err(RecvError::Lagged(n)) => {
                if !lagged_warned {
                    tracing::warn!(
                        "send_and_wait broadcast lagged by {n} events; partial text may be lost"
                    );
                    lagged_warned = true;
                }
                continue;
            }
            Err(RecvError::Closed) => {
                return Err("session daemon closed before result event".into());
            }
        };
        if seq <= baseline_seq {
            // Pre-existing history that arrived through the channel as part
            // of replay seeding. Skip — we want post-baseline events only.
            continue;
        }
        if let Some(payload) = agg.consume_json(&json) {
            return Ok(payload);
        }
    }
}

/// Stateful aggregator for one claude turn. Driven by `consume_json`, which
/// returns `Some(payload)` once a `result` event closes the turn.
///
/// Pulled out of the broadcast loop so it can be unit-tested without a
/// daemon: the loop is just `recv → consume_json → maybe-return`.
#[derive(Default)]
pub(super) struct TurnAggregator {
    text_buf: String,
    tool_calls: Vec<Value>,
    /// tool_use_id → tool_name, captured at content_block_start so the
    /// later tool_result frame can be labeled by name.
    tool_names: std::collections::HashMap<String, String>,
}

impl TurnAggregator {
    pub(super) fn consume_json(&mut self, json: &str) -> Option<Value> {
        let v: Value = serde_json::from_str(json).ok()?;
        let ev_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ev_type {
            "assistant_text_delta" => {
                if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
                    self.text_buf.push_str(t);
                }
                None
            }
            "assistant_content_block_start" => {
                if let Some(block) = v.get("block")
                    && block.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                {
                    let id = block.get("id").and_then(|s| s.as_str()).unwrap_or("");
                    let name = block.get("name").and_then(|s| s.as_str()).unwrap_or("");
                    if !id.is_empty() {
                        self.tool_names.insert(id.to_string(), name.to_string());
                    }
                }
                None
            }
            "tool_result" => {
                let tool_use_id = v
                    .get("tool_use_id")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = self.tool_names.remove(&tool_use_id).unwrap_or_default();
                self.tool_calls.push(json!({
                    "tool_use_id": tool_use_id,
                    "name": name,
                    "is_error": v.get("is_error").cloned().unwrap_or(json!(false)),
                    "content": v.get("content").cloned().unwrap_or(Value::Null),
                }));
                None
            }
            "result" => Some(self.finalize(v)),
            _ => None,
        }
    }

    fn finalize(&mut self, result_event: Value) -> Value {
        let is_error = result_event
            .get("is_error")
            .and_then(|b| b.as_bool())
            .unwrap_or(false);
        let terminal_reason = result_event
            .get("terminal_reason")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        let status = if is_error {
            "error"
        } else if terminal_reason == "interrupted" || terminal_reason == "stopped" {
            "stopped"
        } else {
            "completed"
        };
        json!({
            "status": status,
            "text": std::mem::take(&mut self.text_buf),
            "tool_calls": std::mem::take(&mut self.tool_calls),
            "result": result_event,
            // Reserved slot for A2A-style human-in-the-loop in cross-session
            // send_message flows. Runner-side AskUserQuestion prompts are
            // handled on the live chat WebSocket and don't currently surface
            // through this response shape.
            "pending_question": Value::Null,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(s: &str) -> &str {
        s
    }

    #[test]
    fn aggregator_collects_text_deltas_and_terminates_on_result() {
        let mut agg = TurnAggregator::default();
        assert!(
            agg.consume_json(ev(r#"{"type":"assistant_text_delta","text":"hel"}"#))
                .is_none()
        );
        assert!(
            agg.consume_json(ev(r#"{"type":"assistant_text_delta","text":"lo"}"#))
                .is_none()
        );
        let payload = agg
            .consume_json(ev(
                r#"{"type":"result","is_error":false,"terminal_reason":"end_turn"}"#,
            ))
            .expect("result must terminate the aggregator");
        assert_eq!(payload["status"], "completed");
        assert_eq!(payload["text"], "hello");
        assert_eq!(payload["tool_calls"].as_array().unwrap().len(), 0);
        assert!(payload["pending_question"].is_null());
    }

    #[test]
    fn aggregator_marks_status_error_when_is_error_true() {
        let mut agg = TurnAggregator::default();
        let payload = agg
            .consume_json(ev(
                r#"{"type":"result","is_error":true,"terminal_reason":"max_turns"}"#,
            ))
            .unwrap();
        // is_error wins over terminal_reason — so even a "stopped"-looking
        // reason should surface as error to the orchestrator.
        assert_eq!(payload["status"], "error");
    }

    #[test]
    fn aggregator_marks_status_stopped_on_interrupt() {
        let mut agg = TurnAggregator::default();
        let payload = agg
            .consume_json(ev(
                r#"{"type":"result","is_error":false,"terminal_reason":"interrupted"}"#,
            ))
            .unwrap();
        assert_eq!(payload["status"], "stopped");
    }

    #[test]
    fn aggregator_pairs_tool_use_block_with_tool_result() {
        let mut agg = TurnAggregator::default();
        agg.consume_json(ev(
            r#"{"type":"assistant_content_block_start","block":{"type":"tool_use","id":"toolu_1","name":"Bash","input":{}}}"#,
        ));
        agg.consume_json(ev(
            r#"{"type":"tool_result","tool_use_id":"toolu_1","is_error":false,"content":"ok"}"#,
        ));
        let payload = agg
            .consume_json(ev(
                r#"{"type":"result","is_error":false,"terminal_reason":"end_turn"}"#,
            ))
            .unwrap();
        let calls = payload["tool_calls"].as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["tool_use_id"], "toolu_1");
        assert_eq!(calls[0]["name"], "Bash");
        assert_eq!(calls[0]["is_error"], false);
        assert_eq!(calls[0]["content"], "ok");
    }

    #[test]
    fn aggregator_ignores_unrelated_event_types() {
        let mut agg = TurnAggregator::default();
        for j in [
            r#"{"type":"session_init","model":"claude"}"#,
            r#"{"type":"status_change","status":"working"}"#,
            r#"{"type":"some_future_event","payload":42}"#,
            r#"{"type":"passthrough","kind":"hook.pre_tool_use.started"}"#,
        ] {
            assert!(
                agg.consume_json(j).is_none(),
                "unrelated events must not terminate: {j}"
            );
        }
        let payload = agg
            .consume_json(r#"{"type":"result","is_error":false,"terminal_reason":"end_turn"}"#)
            .unwrap();
        assert_eq!(payload["status"], "completed");
    }

    #[test]
    fn aggregator_skips_non_json_lines() {
        let mut agg = TurnAggregator::default();
        assert!(agg.consume_json("not json").is_none());
        assert!(agg.consume_json("{").is_none());
        let payload = agg
            .consume_json(r#"{"type":"result","is_error":false,"terminal_reason":"end_turn"}"#)
            .unwrap();
        assert_eq!(payload["status"], "completed");
    }
}
