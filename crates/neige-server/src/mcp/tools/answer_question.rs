use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::mcp::chat::send_and_wait;
use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {
    pub answer: String,
}

pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String> {
    let session_id = ctx.session_id_required()?;
    send_and_wait(ctx.manager(), session_id, args.answer).await
}

pub fn tool() -> Tool {
    Tool::new(
        "answer_question",
        "Answer a pending `pending_question` from a previous send_message \
         response. Currently a thin wrapper that posts the answer as a follow-up \
         user message. Live web UI AskUserQuestion dialogs are resolved through \
         the chat WebSocket; this MCP tool is for orchestrator-to-session text \
         handoffs. Returns the same shape as send_message.",
        Scope::SelfScoped,
        handle,
    )
}
