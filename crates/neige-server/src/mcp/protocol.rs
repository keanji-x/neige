//! Minimal MCP wire types we need on the server.
//!
//! We only implement the subset Claude Code's MCP HTTP client actually
//! exercises: `initialize`, `notifications/initialized`, `tools/list`,
//! `tools/call`. Everything else returns method-not-found so a misconfigured
//! client gets a clean error instead of silent acceptance.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 request envelope. `id` is missing for notifications.
///
/// We accept (and ignore) the `jsonrpc` field — Claude Code's HTTP MCP
/// client always sends `"2.0"`, but we don't bother validating since
/// rejecting on a stray version would just cause user-facing breakage if
/// the spec evolves.
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    #[serde(default, rename = "jsonrpc")]
    pub _jsonrpc: serde::de::IgnoredAny,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcResponse {
    pub fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

// -- standard JSON-RPC error codes --------------------------------------------

pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;

// -- MCP-specific shapes ------------------------------------------------------

/// Server descriptor returned by `initialize`. The protocolVersion is what
/// we *speak*; clients negotiate by sending their own and we echo ours.
pub fn initialize_result(server_name: &str, server_version: &str) -> Value {
    serde_json::json!({
        // Pick a current MCP protocol revision. Claude Code's HTTP MCP client
        // accepts any well-formed string here and falls back to its own
        // negotiated default if it doesn't recognize ours.
        "protocolVersion": "2025-06-18",
        "capabilities": {
            "tools": {},
        },
        "serverInfo": {
            "name": server_name,
            "version": server_version,
        },
    })
}

/// One entry in the `tools/list` response.
#[derive(Debug, Serialize)]
pub struct ToolDescriptor {
    pub name: &'static str,
    pub description: &'static str,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

/// `tools/call` result envelope. We always return a single text content block
/// containing JSON-encoded tool output — clients that surface MCP results to
/// an LLM will see the full structured payload.
pub fn tool_text_result(json: &Value) -> Value {
    serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(json).unwrap_or_else(|_| "null".to_string()),
        }],
        "isError": false,
    })
}

pub fn tool_error_result(message: &str) -> Value {
    serde_json::json!({
        "content": [{
            "type": "text",
            "text": message,
        }],
        "isError": true,
    })
}
