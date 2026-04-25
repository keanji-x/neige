//! The unified event contract that the rest of neige consumes.
//!
//! [`NeigeEvent`] is intentionally source-agnostic: today it's produced
//! from stream-json output, tomorrow we may also produce it from a JSONL
//! transcript tail. Downstream code (the daemon, the WebSocket layer, the
//! frontend) should only ever see this type.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NeigeEvent {
    SessionInit {
        session_id: Uuid,
        model: String,
        permission_mode: String,
        cwd: String,
        version: String,
        tools: Vec<String>,
        mcp_servers: Vec<McpServerInfo>,
        slash_commands: Vec<String>,
        agents: Vec<String>,
        skills: Vec<String>,
        plugins: Vec<PluginInfo>,
    },
    StatusChange {
        session_id: Uuid,
        status: String,
    },
    /// Pass-through; the frontend renders the rate-limit details so we
    /// keep the raw shape rather than re-marshalling fields we don't read.
    RateLimit {
        session_id: Uuid,
        info: Value,
    },
    UserMessage {
        session_id: Uuid,
        content: Vec<ContentBlock>,
    },
    AssistantMessageStart {
        session_id: Uuid,
        message_id: String,
        model: String,
        parent_tool_use_id: Option<String>,
    },
    AssistantContentBlockStart {
        session_id: Uuid,
        message_id: String,
        index: u32,
        block: ContentBlock,
    },
    AssistantTextDelta {
        session_id: Uuid,
        message_id: String,
        index: u32,
        text: String,
    },
    AssistantThinkingDelta {
        session_id: Uuid,
        message_id: String,
        index: u32,
        text: String,
    },
    AssistantToolUseInputDelta {
        session_id: Uuid,
        message_id: String,
        index: u32,
        partial_json: String,
    },
    AssistantContentBlockStop {
        session_id: Uuid,
        message_id: String,
        index: u32,
    },
    AssistantMessageDelta {
        session_id: Uuid,
        message_id: String,
        stop_reason: Option<String>,
        usage: Option<Value>,
    },
    AssistantMessageStop {
        session_id: Uuid,
        message_id: String,
    },
    /// Full assistant message snapshot emitted after each `content_block_stop`.
    /// Downstream consumers should pick either this OR the deltas, not both.
    AssistantCheckpoint {
        session_id: Uuid,
        message: Value,
    },
    ToolResult {
        session_id: Uuid,
        tool_use_id: String,
        content: ToolResultContent,
        is_error: bool,
    },
    Result {
        session_id: Uuid,
        subtype: String,
        is_error: bool,
        duration_ms: u64,
        total_cost_usd: f64,
        terminal_reason: String,
        permission_denials: Vec<Value>,
    },
}

/// Content block, whether it's part of an assistant message, a user
/// message, or wrapped in a `tool_result`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: ToolResultContent,
        #[serde(default)]
        is_error: bool,
    },
    Image {
        source: Value,
    },
    /// Block type we don't recognize. Kept verbatim so future shapes don't
    /// disappear silently.
    Unknown {
        type_name: String,
        value: Value,
    },
}

/// `tool_result.content` is polymorphic on the wire: either a plain string
/// (the common case for short text outputs) or an array of nested content
/// blocks (image returns, multi-part outputs).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolResultContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInfo {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub source: Option<String>,
}
