use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::mcp::chat::send_and_wait;
use crate::mcp::registry::{Scope, Tool, ToolCtx};

#[derive(Deserialize, JsonSchema)]
pub struct Args {
    /// Chat session to ask, addressed by `name`. Required at /mcp; defaults
    /// to the URL session id at /mcp/{id}, in which case the question pops
    /// up as a dialog to the human watching this session in the web UI.
    #[serde(default)]
    pub session: Option<String>,
    /// The question text.
    pub question: String,
    /// Optional preset answer choices. Cross-session: surfaced inline.
    /// Self-ask: rendered as clickable buttons in the dialog (the user can
    /// also type a free-form answer).
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String> {
    let target = ctx.target_chat_session(args.session.as_deref()).await?;

    if ctx.session_id() == Some(target) {
        // Self-ask: emit a dialog event into the chat stream and block on
        // a oneshot receiver that the chat WS handler resolves when the
        // user submits an answer.
        return self_ask(ctx, target, args.question, args.options).await;
    }

    // Cross-session ask: framed send_message. The framing tells the
    // receiving claude this is a question, not a directive.
    let mut framed = format!(
        "Question from session {}: {}",
        session_id_short(ctx.session_id()),
        args.question
    );
    if let Some(options) = args.options
        && !options.is_empty()
    {
        framed.push_str("\n\nSuggested options:\n");
        for o in options {
            framed.push_str(&format!("- {}\n", o));
        }
    }
    framed
        .push_str("\n\n(This was sent via the ask_question MCP tool — the caller is waiting for your reply.)");

    send_and_wait(ctx.manager(), target, framed).await
}

/// Self-ask flow: surface the question as a `Passthrough` event in the
/// chat WS so any frontend client viewing the session renders a dialog,
/// then block until the user answers.
async fn self_ask(
    ctx: ToolCtx,
    target: Uuid,
    question: String,
    options: Option<Vec<String>>,
) -> Result<Value, String> {
    let question_id = Uuid::new_v4();
    let (tx, rx) = oneshot::channel::<String>();

    // Register the pending question BEFORE injecting the event — that way
    // a fast frontend can't deliver the answer before we're ready to
    // receive it. (The other order would be a TOCTOU: event lands → user
    // answers in <1 frame → AnswerQuestion arrives → registry empty → drop.)
    {
        let mut pending = ctx.state().pending_questions.lock().await;
        pending.insert((target, question_id), tx);
    }

    // Inject the dialog event. We use the existing Passthrough variant
    // with kind="neige.ask_user_question" so the frontend's passthrough
    // renderer registry can pick it up (see web-shared/passthrough/).
    let event_json = json!({
        "type": "passthrough",
        "session_id": target.to_string(),
        "kind": "neige.ask_user_question",
        "payload": {
            "question_id": question_id.to_string(),
            "question": question,
            "options": options.unwrap_or_default(),
        }
    })
    .to_string();

    {
        let mgr = ctx.manager();
        let guard = mgr.lock().await;
        let conv = guard
            .get(&target)
            .ok_or_else(|| "session not found".to_string())?;
        let client = conv.chat_client.as_ref().ok_or_else(|| {
            "session is not in chat mode (cannot surface a dialog without an active chat WS)"
                .to_string()
        })?;
        client.inject_synthetic_event(event_json);
    }

    // Block until the user answers (or the sender is dropped — e.g.
    // session deleted, server restart). No wall-clock timeout: the user
    // may walk away and come back hours later, and the sender survives
    // server detach since pending_questions lives on AppState.
    match rx.await {
        Ok(answer) => Ok(json!({
            "status": "answered",
            "question_id": question_id,
            "answer": answer,
        })),
        Err(_) => {
            // Cleanup — usually already done by whoever dropped the sender,
            // but harmless to remove again under the lock.
            let mut pending = ctx.state().pending_questions.lock().await;
            pending.remove(&(target, question_id));
            Err("question abandoned (session closed or answerer dropped)".to_string())
        }
    }
}

fn session_id_short(id: Option<Uuid>) -> String {
    match id {
        Some(id) => id.to_string()[..8].to_string(),
        None => "<orchestrator>".to_string(),
    }
}

pub fn tool() -> Tool {
    Tool::new(
        "ask_question",
        "Pose a question and block until the answer arrives. Two modes \
         picked by session_id:\n\
         (1) cross-session (session_id != caller): question is framed and \
         forwarded as a user_message; reply is the receiving claude's next \
         turn output.\n\
         (2) self-ask (session_id == caller, only at /mcp/{id}): a dialog \
         pops up in the web UI for the human watching this session; reply \
         is the user's typed answer. No timeout — the dialog can stay open \
         indefinitely.\n\
         Returns {status, answer, question_id} for self-ask, or {status, \
         text, tool_calls, result, pending_question} for cross-session.",
        Scope::Global,
        handle,
    )
}
