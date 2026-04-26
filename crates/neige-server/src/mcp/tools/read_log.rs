use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::attach::chat::AttachResult;
use crate::conversation::SessionMode;
use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {
    /// Highest event seq the caller already has. Omit to get every buffered event.
    #[serde(default)]
    pub last_seq: Option<u64>,
}

pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String> {
    let session_id = ctx.session_id_required()?;
    let mgr = ctx.manager();
    let guard = mgr.lock().await;
    let conv = guard
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    let client = conv.chat_client.as_ref().ok_or_else(|| {
        if matches!(conv.mode, SessionMode::Chat { .. }) {
            "session is detached — call resume_session or send_message first".to_string()
        } else {
            "session is not in chat mode (terminal sessions don't have a chat log)".to_string()
        }
    })?;
    // Subscribe just to read the snapshot/delta — we drop rx
    // immediately, we only want the historical payload.
    let (_rx, attach) = client.attach(args.last_seq);
    let (events, latest_seq) = match attach {
        AttachResult::UpToDate { latest_seq } => (Vec::new(), latest_seq),
        AttachResult::Delta { events, latest_seq } => (events, latest_seq),
        AttachResult::Snapshot { events, latest_seq } => (events, latest_seq),
    };
    let parsed_events: Vec<Value> = events
        .into_iter()
        .map(|(seq, json)| {
            let event: Value = serde_json::from_str(&json).unwrap_or(Value::Null);
            json!({"seq": seq, "event": event})
        })
        .collect();
    Ok(json!({
        "events": parsed_events,
        "latest_seq": latest_seq,
    }))
}

pub fn tool() -> Tool {
    Tool::new(
        "read_log",
        "Read buffered chat events for this session since `last_seq` (or all of \
         them if omitted). Each event is one stream-json NeigeEvent. Useful for \
         auditing what happened between MCP calls. NOTE: events live in the \
         daemon's in-memory ring buffer, so a detached session returns an error \
         — call resume_session (or send_message, which auto-resumes) first.",
        Scope::SelfScoped,
        handle,
    )
}
