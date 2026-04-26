use neige_session::ClientMsg;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::conversation::SessionMode;
use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {}

pub async fn handle(ctx: ToolCtx, _args: Args) -> Result<Value, String> {
    let session_id = ctx.session_id_required()?;
    let mgr = ctx.manager();
    let sender = {
        let guard = mgr.lock().await;
        let conv = guard
            .get(&session_id)
            .ok_or_else(|| "session not found".to_string())?;
        let client = conv.chat_client.as_ref().ok_or_else(|| {
            if matches!(conv.mode, SessionMode::Chat { .. }) {
                "session is detached — nothing to stop".to_string()
            } else {
                "session is not in chat mode".to_string()
            }
        })?;
        client.ctrl_sender()
    };
    sender
        .send(ClientMsg::ChatStop)
        .map_err(|_| "daemon channel closed".to_string())?;
    Ok(json!({"stopped": true}))
}

pub fn tool() -> Tool {
    Tool::new(
        "stop",
        "Interrupt the current claude generation (SIGINT). Returns immediately. \
         The in-flight send_message call (if any) will observe a `result` event \
         with terminal_reason=interrupted and unblock with status=stopped.",
        Scope::SelfScoped,
        handle,
    )
}
