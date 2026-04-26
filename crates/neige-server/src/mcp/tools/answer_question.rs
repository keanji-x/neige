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
         user message — the AskUserQuestion built-in is disabled in chat-mode \
         claude until an MCP-native replacement ships, so questions surface as \
         plain assistant text and answers go back the same way. Returns the same \
         shape as send_message.",
        Scope::SelfScoped,
        handle,
    )
}
