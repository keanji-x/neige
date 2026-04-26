use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {}

pub async fn handle(ctx: ToolCtx, _args: Args) -> Result<Value, String> {
    let mgr = ctx.manager();
    let guard = mgr.lock().await;
    Ok(serde_json::to_value(guard.list()).unwrap_or(Value::Null))
}

pub fn tool() -> Tool {
    Tool::new(
        "list_sessions",
        "List all neige sessions (id, title, status, cwd, mode). \
         Use this to find a session_id before sending messages.",
        Scope::Global,
        handle,
    )
}
