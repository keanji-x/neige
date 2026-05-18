use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {
    /// Chat session to resume, by `name`.
    pub session: String,
}

pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String> {
    let target = ctx.resolve_chat_session(&args.session).await?;
    let mgr = ctx.manager();
    let mut guard = mgr.lock().await;
    let info = guard.resume(&target).await?;
    Ok(serde_json::to_value(info).unwrap_or(Value::Null))
}

pub fn tool() -> Tool {
    Tool::new(
        "resume_session",
        "Reattach to a detached chat session by `name` — spawns a fresh \
         daemon if the previous one is gone, otherwise no-op. Returns the \
         session info. send_message auto-resumes too, so this is mainly \
         useful for warming up a session before a latency-sensitive call.",
        Scope::Global,
        handle,
    )
}
