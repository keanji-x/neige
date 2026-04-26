use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::mcp::chat::send_and_wait;
use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {
    /// Chat session to message, identified by its `name` (the addressing
    /// handle picked at create_session time). Terminal sessions cannot
    /// receive messages this way and are not in the chat-name index.
    pub session: String,
    pub content: String,
}

pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String> {
    let target = ctx.resolve_chat_session(&args.session).await?;
    // Self-loop check: only meaningful when called via /mcp/{id} — the URL
    // session id is the *caller*. Refusing equality stops a session from
    // posting messages to itself which would deadlock the chat daemon
    // (one stdin write blocks on its own response).
    if ctx.session_id() == Some(target) {
        return Err("self-loop refused: a session cannot send_message to itself".to_string());
    }
    send_and_wait(ctx.manager(), target, args.content).await
}

pub fn tool() -> Tool {
    Tool::new(
        "send_message",
        "Send a user message to a chat session and block until the assistant's \
         full reply lands (a stream-json `result` event). Address the target \
         by its `name` (set at create_session time). The call may block \
         indefinitely if claude pauses for human input (permission prompts, \
         AskUserQuestion); call `stop` to interrupt. Returns {status, text, \
         tool_calls, result, pending_question}. REFUSAL: a session cannot \
         send_message to itself (would deadlock the chat daemon).",
        Scope::Global,
        handle,
    )
}
