//! Wire-shape mirror of Claude Code stream-json events.
//!
//! Each variant holds only the fields we currently care about; everything
//! else is captured in an `extras: serde_json::Value` bucket so we don't
//! break when Claude adds fields. There is intentionally **no**
//! `deny_unknown_fields` anywhere in this module — Claude is upgrading the
//! schema constantly and forward compatibility wins over strictness.

use serde::de::Deserializer;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A single line from a stream-json NDJSON stream.
///
/// Dispatched on the top-level `"type"` field. Anything we don't recognize
/// falls through to [`RawStreamJsonEvent::Unknown`] which preserves the
/// original JSON so future code can still inspect it.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum RawStreamJsonEvent {
    System(SystemEvent),
    RateLimit(RateLimitEvent),
    Stream(StreamEventWrapper),
    Assistant(AssistantCheckpointEvent),
    User(UserEvent),
    Result(ResultEvent),
    /// Top-level `type` we don't know about. Preserved verbatim.
    Unknown(Value),
}

/// We deserialize manually: parse into a `Value` first, dispatch on the
/// `"type"` discriminator, fall back to `Unknown` if the type is missing or
/// unrecognized OR if the recognized-type body fails to deserialize. This
/// keeps the parser robust against schema drift and avoids the limitations
/// of `#[serde(tag = "type")]` + `#[serde(other)]` (which can't capture
/// payload).
impl<'de> Deserialize<'de> for RawStreamJsonEvent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let ty = value
            .get("type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_owned());

        let Some(ty) = ty else {
            return Ok(RawStreamJsonEvent::Unknown(value));
        };

        match ty.as_str() {
            "system" => match serde_json::from_value::<SystemEvent>(value.clone()) {
                Ok(ev) => Ok(RawStreamJsonEvent::System(ev)),
                Err(_) => Ok(RawStreamJsonEvent::Unknown(value)),
            },
            "rate_limit_event" => match serde_json::from_value::<RateLimitEvent>(value.clone()) {
                Ok(ev) => Ok(RawStreamJsonEvent::RateLimit(ev)),
                Err(_) => Ok(RawStreamJsonEvent::Unknown(value)),
            },
            "stream_event" => match serde_json::from_value::<StreamEventWrapper>(value.clone()) {
                Ok(ev) => Ok(RawStreamJsonEvent::Stream(ev)),
                Err(_) => Ok(RawStreamJsonEvent::Unknown(value)),
            },
            "assistant" => {
                match serde_json::from_value::<AssistantCheckpointEvent>(value.clone()) {
                    Ok(ev) => Ok(RawStreamJsonEvent::Assistant(ev)),
                    Err(_) => Ok(RawStreamJsonEvent::Unknown(value)),
                }
            }
            "user" => match serde_json::from_value::<UserEvent>(value.clone()) {
                Ok(ev) => Ok(RawStreamJsonEvent::User(ev)),
                Err(_) => Ok(RawStreamJsonEvent::Unknown(value)),
            },
            "result" => match serde_json::from_value::<ResultEvent>(value.clone()) {
                Ok(ev) => Ok(RawStreamJsonEvent::Result(ev)),
                Err(_) => Ok(RawStreamJsonEvent::Unknown(value)),
            },
            _ => Ok(RawStreamJsonEvent::Unknown(value)),
        }
    }
}

// -- system ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
pub enum SystemEvent {
    Init(SystemInit),
    Status(SystemStatus),
    /// Any other system subtype. Captured verbatim so we don't lose data.
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInit {
    pub session_id: String,
    pub model: String,
    #[serde(rename = "permissionMode", default)]
    pub permission_mode: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub claude_code_version: String,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub mcp_servers: Vec<RawMcpServer>,
    #[serde(default)]
    pub slash_commands: Vec<String>,
    #[serde(default)]
    pub agents: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub plugins: Vec<RawPlugin>,
    /// Anything else (apiKeySource, output_style, memory_paths, uuid, …)
    /// passes through here so we never silently drop data.
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawMcpServer {
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawPlugin {
    pub name: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    pub session_id: String,
    pub status: String,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

// -- rate limit --------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitEvent {
    pub session_id: String,
    #[serde(default)]
    pub rate_limit_info: Value,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

// -- stream_event ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEventWrapper {
    pub session_id: String,
    pub event: StreamEventInner,
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

/// Inner Anthropic Messages-API streaming event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEventInner {
    MessageStart {
        message: Value,
    },
    ContentBlockStart {
        index: u32,
        content_block: Value,
    },
    ContentBlockDelta {
        index: u32,
        delta: ContentBlockDelta,
    },
    ContentBlockStop {
        index: u32,
    },
    MessageDelta {
        delta: Value,
        #[serde(default)]
        usage: Option<Value>,
    },
    MessageStop,
    /// Some future inner event type.
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlockDelta {
    TextDelta {
        text: String,
    },
    ThinkingDelta {
        thinking: String,
    },
    InputJsonDelta {
        partial_json: String,
    },
    SignatureDelta {
        signature: String,
    },
    /// Future delta variants (citations_delta, etc).
    #[serde(other)]
    Other,
}

// -- assistant checkpoint ----------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantCheckpointEvent {
    pub session_id: String,
    pub message: Value,
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

// -- user --------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserEvent {
    pub session_id: String,
    pub message: UserMessage,
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMessage {
    #[serde(default)]
    pub role: Option<String>,
    pub content: UserContent,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

/// `user` messages may have a plain string body (a real user prompt) or an
/// array of blocks (synthesized tool_result wrapper messages emitted by the
/// CLI after every tool call).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UserContent {
    Text(String),
    Blocks(Vec<Value>),
}

// -- result ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultEvent {
    pub session_id: String,
    #[serde(default)]
    pub subtype: String,
    #[serde(default)]
    pub is_error: bool,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub total_cost_usd: f64,
    #[serde(default)]
    pub terminal_reason: String,
    #[serde(default)]
    pub permission_denials: Vec<Value>,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, Value>,
}

// -- parsing -----------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("stream-json line is not valid JSON ({snippet:?}): {source}")]
    Json {
        snippet: String,
        #[source]
        source: serde_json::Error,
    },
}

/// Parse a single NDJSON line into a [`RawStreamJsonEvent`] plus the
/// original [`Value`].
///
/// We hand back both because the unified-event mapper needs the verbatim
/// JSON to build a [`crate::stream_json::unified::NeigeEvent::Passthrough`]
/// for events we don't model with a typed variant (hook events, unknown
/// top-level types, unknown system subtypes, etc). Re-serializing the
/// typed parse would lose forward-compatibility fields and would also
/// be lossy for `*::Other` variants which discard their payload.
///
/// Trailing `\r\n` / `\n` are tolerated. Unknown top-level types are
/// returned as `Unknown` rather than producing an error, so callers can
/// drive a parser loop without ever panicking on schema drift.
pub fn parse_line(line: &str) -> Result<(RawStreamJsonEvent, Value), ParseError> {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    let value: Value = serde_json::from_str(trimmed).map_err(|source| ParseError::Json {
        snippet: trimmed.chars().take(200).collect(),
        source,
    })?;
    // Re-route through `serde_json::from_value` rather than reparsing the
    // string twice. The custom `Deserialize` impl below already handles
    // the dispatch + Unknown fallback, so this is infallible in practice
    // (a `Value` always deserializes into RawStreamJsonEvent).
    let raw = serde_json::from_value::<RawStreamJsonEvent>(value.clone()).map_err(|source| {
        ParseError::Json {
            snippet: trimmed.chars().take(200).collect(),
            source,
        }
    })?;
    Ok((raw, value))
}
