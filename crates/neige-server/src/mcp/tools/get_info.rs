use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {}

pub async fn handle(ctx: ToolCtx, _args: Args) -> Result<Value, String> {
    let session_id = ctx.session_id_required()?;
    let mgr = ctx.manager();
    let guard = mgr.lock().await;
    let conv = guard
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    Ok(serde_json::to_value(conv.info()).unwrap_or(Value::Null))
}

pub fn tool() -> Tool {
    Tool::new(
        "get_info",
        "Return current metadata for this session: id, title, status, program, \
         cwd, mode. Cheap, doesn't touch the daemon.",
        Scope::SelfScoped,
        handle,
    )
}
