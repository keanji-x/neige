//! Streamable HTTP MCP transport for neige.
//!
//! Two router prefixes:
//!   - `POST /mcp`              — Global-scoped tools (list/create/delete/resume sessions, send_message)
//!   - `POST /mcp/{session_id}` — Global + SelfScoped tools, the URL id becomes the caller's identity
//!
//! Both speak JSON-RPC 2.0 over a single POST round-trip. We don't open SSE
//! streams: each tool call returns one JSON response when the work
//! completes, and `send_message` legitimately blocks for as long as the
//! claude turn takes (including blocking forever if the model is waiting on
//! a permission prompt — that's intentional, the orchestrating Claude will
//! decide when to `stop`).
//!
//! Auth is handled by the existing `auth_middleware` higher up the tower
//! stack — by the time a request reaches here it's already been validated
//! against the Bearer token (or `--no-auth` is set).
//!
//! ## Adding tools
//!
//! See `mcp/tools/mod.rs`. One file per tool, three things to write:
//! `Args` struct (Deserialize+JsonSchema), `handle` async fn, `tool()` ctor.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::api::AppState;

mod chat;
mod protocol;
pub mod registry;
mod tools;

use protocol::{
    INVALID_PARAMS, INVALID_REQUEST, JsonRpcRequest, JsonRpcResponse, METHOD_NOT_FOUND,
    initialize_result, tool_error_result, tool_text_result,
};
use registry::ToolCtx;
use tools::ToolSet;

const SERVER_NAME: &str = "neige";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mcp", post(global_handler))
        .route("/mcp/{id}", post(session_handler))
}

async fn global_handler(
    State(state): State<AppState>,
    Json(req): Json<Value>,
) -> impl IntoResponse {
    dispatch(state, None, ToolSet::for_global_route(), req).await
}

async fn session_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<Value>,
) -> impl IntoResponse {
    dispatch(state, Some(id), ToolSet::for_session_route(), req).await
}

/// Run a single JSON-RPC request through the given tool set.
///
/// Notifications (no `id`) get a 202 with empty body — JSON-RPC says
/// notifications have no response, but axum needs *some* return value.
async fn dispatch(
    state: AppState,
    session_id: Option<Uuid>,
    tools: ToolSet,
    raw: Value,
) -> (StatusCode, Json<Value>) {
    // Reject malformed requests early, before we try to read fields.
    let parsed: JsonRpcRequest = match serde_json::from_value(raw.clone()) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::OK,
                Json(serde_json::to_value(JsonRpcResponse::err(
                    Value::Null,
                    INVALID_REQUEST,
                    format!("invalid JSON-RPC request: {e}"),
                ))
                .unwrap()),
            );
        }
    };

    let id = parsed.id.clone();
    let is_notification = id.is_none();

    let result: Result<Value, (i32, String)> = match parsed.method.as_str() {
        "initialize" => Ok(initialize_result(SERVER_NAME, SERVER_VERSION)),
        // Acknowledged-but-ignored: the spec says clients send this after
        // initialize to confirm they're ready. No payload required.
        "notifications/initialized" => Ok(Value::Null),
        "tools/list" => {
            let descriptors: Vec<&protocol::ToolDescriptor> =
                tools.tools.iter().map(|t| &t.descriptor).collect();
            Ok(json!({ "tools": descriptors }))
        }
        "tools/call" => handle_tools_call(state, session_id, &tools, &parsed.params).await,
        // ping is handy for liveness checks; clients sometimes send it.
        "ping" => Ok(json!({})),
        other => Err((METHOD_NOT_FOUND, format!("method not found: {other}"))),
    };

    if is_notification {
        // No body for notifications, but axum needs something serializable.
        return (StatusCode::ACCEPTED, Json(Value::Null));
    }

    let id = id.unwrap_or(Value::Null);
    let body = match result {
        Ok(value) => JsonRpcResponse::ok(id, value),
        Err((code, msg)) => JsonRpcResponse::err(id, code, msg),
    };
    (
        StatusCode::OK,
        Json(serde_json::to_value(body).unwrap_or(Value::Null)),
    )
}

async fn handle_tools_call(
    state: AppState,
    session_id: Option<Uuid>,
    tools: &ToolSet,
    params: &Value,
) -> Result<Value, (i32, String)> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or((INVALID_PARAMS, "missing tools/call.name".to_string()))?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    let tool = tools
        .find(name)
        .ok_or((METHOD_NOT_FOUND, format!("unknown tool: {name}")))?;

    let ctx = ToolCtx::new(state, session_id);
    // Tool errors are surfaced as `isError: true` content inside a normal
    // success response, not a JSON-RPC error — that's what MCP clients
    // expect, since "tool failed" is not a protocol-level failure.
    Ok(match (tool.handler)(ctx, arguments).await {
        Ok(value) => tool_text_result(&value),
        Err(msg) => tool_error_result(&msg),
    })
}

#[cfg(test)]
mod tests {
    use super::protocol::*;
    use serde_json::json;

    #[test]
    fn jsonrpc_response_ok_serializes_without_error_field() {
        let resp = JsonRpcResponse::ok(json!(1), json!({"x": 1}));
        let serialized = serde_json::to_value(&resp).unwrap();
        assert_eq!(serialized["jsonrpc"], "2.0");
        assert_eq!(serialized["id"], 1);
        assert_eq!(serialized["result"], json!({"x": 1}));
        assert!(serialized.get("error").is_none(), "ok response must omit error");
    }

    #[test]
    fn jsonrpc_response_err_serializes_without_result_field() {
        let resp = JsonRpcResponse::err(json!(2), -32601, "method not found");
        let serialized = serde_json::to_value(&resp).unwrap();
        assert_eq!(serialized["error"]["code"], -32601);
        assert_eq!(serialized["error"]["message"], "method not found");
        assert!(serialized.get("result").is_none(), "err response must omit result");
    }

    #[test]
    fn initialize_result_advertises_tools_capability() {
        let v = initialize_result("neige", "0.1.0");
        assert!(v["capabilities"]["tools"].is_object());
        assert_eq!(v["serverInfo"]["name"], "neige");
    }

    #[test]
    fn tool_text_result_carries_serialized_payload() {
        let v = tool_text_result(&json!({"hello": "world"}));
        assert_eq!(v["isError"], false);
        let text = v["content"][0]["text"].as_str().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(text).unwrap();
        assert_eq!(parsed["hello"], "world");
    }

    #[test]
    fn tool_error_result_marks_iserror() {
        let v = tool_error_result("boom");
        assert_eq!(v["isError"], true);
        assert_eq!(v["content"][0]["text"], "boom");
    }
}
