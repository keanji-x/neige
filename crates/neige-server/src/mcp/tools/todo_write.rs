use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::conversation::{Todo, write_todos};
use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {
    /// The full new todo list. Replaces whatever was there — TodoWrite-style.
    /// Items not in this list are removed.
    pub todos: Vec<Todo>,
}

pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String> {
    let session_id = ctx.session_id_required()?;
    let project_cwd = {
        let mgr = ctx.manager();
        let guard = mgr.lock().await;
        // Verify the session exists before we write a stray todos file
        // that wouldn't get cleaned up by remove_session_file.
        if guard.get(&session_id).is_none() {
            return Err("session not found".to_string());
        }
        guard.project_cwd().to_string()
    };
    write_todos(&session_id, &project_cwd, &args.todos)?;
    Ok(json!({"todos": args.todos}))
}

pub fn tool() -> Tool {
    Tool::new(
        "todo_write",
        "Replace the current session's todo list with the supplied array. \
         Use the same shape as Claude Code's TodoWrite tool: each entry has \
         {id, text, status}. Status is one of pending / in_progress / \
         completed. Persisted to .neige/sessions/<id>.todos.json. To read \
         another session's list, use todo_read with an explicit session_id.",
        Scope::SelfScoped,
        handle,
    )
}
