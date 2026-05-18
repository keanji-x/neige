use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::conversation::read_todos;
use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {
    /// Chat session whose list to read, addressed by `name`. Optional when
    /// called via /mcp/{id} — defaults to that URL session id. Required
    /// at /mcp.
    #[serde(default)]
    pub session: Option<String>,
}

pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String> {
    let target = ctx.target_chat_session(args.session.as_deref()).await?;
    let project_cwd = {
        let mgr = ctx.manager();
        let guard = mgr.lock().await;
        if guard.get(&target).is_none() {
            return Err("session not found".to_string());
        }
        guard.project_cwd().to_string()
    };
    let todos = read_todos(&target, &project_cwd);
    Ok(json!({
        "session_id": target,
        "todos": todos,
    }))
}

pub fn tool() -> Tool {
    Tool::new(
        "todo_read",
        "Read a session's todo list. Returns {session_id, todos}. Pass \
         the chat session `name` explicitly to inspect another session; \
         omit it (when calling via /mcp/{id}) to read your own.",
        Scope::Global,
        handle,
    )
}
