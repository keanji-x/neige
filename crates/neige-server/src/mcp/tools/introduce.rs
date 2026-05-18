use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::attach::chat::AttachResult;
use crate::conversation::{SessionMode, read_todos};
use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {
    /// Chat session to introduce, by `name`. Optional when called via
    /// /mcp/{id} — defaults to the URL session id, useful for "tell me
    /// about myself" (works for both terminal and chat self-targets).
    #[serde(default)]
    pub session: Option<String>,
    /// How many of the most recent log events to include (chat sessions only).
    /// Default 20, max 200. 0 disables the recent-log section.
    #[serde(default)]
    pub max_recent_events: Option<u32>,
}

const DEFAULT_RECENT: u32 = 20;
const HARD_CAP_RECENT: u32 = 200;

pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String> {
    let target = ctx.target_chat_session(args.session.as_deref()).await?;
    let recent_cap = args
        .max_recent_events
        .unwrap_or(DEFAULT_RECENT)
        .min(HARD_CAP_RECENT);

    let mgr = ctx.manager();
    let guard = mgr.lock().await;
    let conv = guard
        .get(&target)
        .ok_or_else(|| "session not found".to_string())?;

    let info = conv.info();
    let project_cwd = guard.project_cwd().to_string();

    // Pull recent events from the daemon ring buffer if it's live.
    // Detached chat sessions return an empty list — we don't auto-resume
    // here because introduce should be cheap/read-only.
    let recent_events: Vec<Value> = if recent_cap > 0
        && matches!(conv.mode, SessionMode::Chat { .. })
        && let Some(client) = conv.chat_client.as_ref()
    {
        let (_rx, attach) = client.attach(None);
        let events = match attach {
            AttachResult::UpToDate { .. } => Vec::new(),
            AttachResult::Delta { events, .. } => events,
            AttachResult::Snapshot { events, .. } => events,
        };
        // Take the tail — the daemon already caps the ring buffer, but
        // recent_cap lets the caller bound the response size.
        let tail = events
            .into_iter()
            .rev()
            .take(recent_cap as usize)
            .collect::<Vec<_>>()
            .into_iter()
            .rev();
        tail.map(|(seq, json)| {
            let event: Value = serde_json::from_str(&json).unwrap_or(Value::Null);
            json!({"seq": seq, "event": event})
        })
        .collect()
    } else {
        Vec::new()
    };

    drop(guard);

    let todos = read_todos(&target, &project_cwd);

    Ok(json!({
        "info": info,
        "todos": todos,
        "recent_events": recent_events,
        "recent_events_truncated": recent_events.len() as u32 == recent_cap,
    }))
}

pub fn tool() -> Tool {
    Tool::new(
        "introduce",
        "Snapshot another (or your own) session: returns its metadata, todo \
         list, and the most recent N chat events. Read-only; doesn't wake a \
         detached daemon (recent_events is empty for detached chat sessions). \
         Use this before send_message to figure out who you're talking to.",
        Scope::Global,
        handle,
    )
}
