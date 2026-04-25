//! Translate [`RawStreamJsonEvent`] into one or more [`NeigeEvent`]s.
//!
//! The mapping is intentionally lossy in places — we keep raw `Value`
//! payloads where the frontend needs richer detail than we want to model
//! in Rust (rate limits, message_delta usage, etc) and we silently drop
//! events we don't recognize so a Claude CLI upgrade can never crash a
//! consumer.

use serde_json::Value;
use uuid::Uuid;

use super::raw::{
    AssistantCheckpointEvent, ContentBlockDelta, RateLimitEvent, RawStreamJsonEvent, ResultEvent,
    StreamEventInner, StreamEventWrapper, SystemEvent, SystemInit, SystemStatus, UserContent,
    UserEvent,
};
use super::unified::{ContentBlock, McpServerInfo, NeigeEvent, PluginInfo, ToolResultContent};

/// Map a raw stream-json event to zero or more unified [`NeigeEvent`]s.
///
/// Unknown / malformed events return `Vec::new()` (and log at debug). One
/// raw event can fan out to multiple unified events — most notably a
/// synthesized user-tool_result message produces one [`NeigeEvent::ToolResult`]
/// per `tool_result` block in its content array.
pub fn to_neige_events(raw: RawStreamJsonEvent) -> Vec<NeigeEvent> {
    match raw {
        RawStreamJsonEvent::System(SystemEvent::Init(init)) => map_system_init(init),
        RawStreamJsonEvent::System(SystemEvent::Status(status)) => map_system_status(status),
        RawStreamJsonEvent::System(SystemEvent::Other) => {
            tracing::debug!("stream_json: dropping unknown system subtype");
            Vec::new()
        }
        RawStreamJsonEvent::RateLimit(ev) => map_rate_limit(ev),
        RawStreamJsonEvent::Stream(ev) => map_stream(ev),
        RawStreamJsonEvent::Assistant(ev) => map_assistant_checkpoint(ev),
        RawStreamJsonEvent::User(ev) => map_user(ev),
        RawStreamJsonEvent::Result(ev) => map_result(ev),
        RawStreamJsonEvent::Unknown(value) => {
            tracing::debug!(?value, "stream_json: dropping unknown top-level type");
            Vec::new()
        }
    }
}

fn parse_session_id(s: &str) -> Option<Uuid> {
    Uuid::parse_str(s).ok()
}

fn map_system_init(init: SystemInit) -> Vec<NeigeEvent> {
    let Some(session_id) = parse_session_id(&init.session_id) else {
        tracing::debug!(session_id = %init.session_id, "stream_json: invalid uuid in system init");
        return Vec::new();
    };
    vec![NeigeEvent::SessionInit {
        session_id,
        model: init.model,
        permission_mode: init.permission_mode,
        cwd: init.cwd,
        version: init.claude_code_version,
        tools: init.tools,
        mcp_servers: init
            .mcp_servers
            .into_iter()
            .map(|s| McpServerInfo {
                name: s.name,
                status: s.status,
            })
            .collect(),
        slash_commands: init.slash_commands,
        agents: init.agents,
        skills: init.skills,
        plugins: init
            .plugins
            .into_iter()
            .map(|p| PluginInfo {
                name: p.name,
                source: p.source,
            })
            .collect(),
    }]
}

fn map_system_status(status: SystemStatus) -> Vec<NeigeEvent> {
    let Some(session_id) = parse_session_id(&status.session_id) else {
        return Vec::new();
    };
    vec![NeigeEvent::StatusChange {
        session_id,
        status: status.status,
    }]
}

fn map_rate_limit(ev: RateLimitEvent) -> Vec<NeigeEvent> {
    let Some(session_id) = parse_session_id(&ev.session_id) else {
        return Vec::new();
    };
    vec![NeigeEvent::RateLimit {
        session_id,
        info: ev.rate_limit_info,
    }]
}

fn map_stream(ev: StreamEventWrapper) -> Vec<NeigeEvent> {
    let Some(session_id) = parse_session_id(&ev.session_id) else {
        return Vec::new();
    };
    let parent_tool_use_id = ev.parent_tool_use_id;
    match ev.event {
        StreamEventInner::MessageStart { message } => {
            let message_id = string_field(&message, "id").unwrap_or_default();
            let model = string_field(&message, "model").unwrap_or_default();
            vec![NeigeEvent::AssistantMessageStart {
                session_id,
                message_id,
                model,
                parent_tool_use_id,
            }]
        }
        StreamEventInner::ContentBlockStart {
            index,
            content_block,
        } => {
            let block = parse_content_block(content_block);
            // We don't have a message_id at content_block level — the
            // consumer is expected to track "current message_id" from the
            // most recent MessageStart for the same session.
            vec![NeigeEvent::AssistantContentBlockStart {
                session_id,
                message_id: String::new(),
                index,
                block,
            }]
        }
        StreamEventInner::ContentBlockDelta { index, delta } => match delta {
            ContentBlockDelta::TextDelta { text } => vec![NeigeEvent::AssistantTextDelta {
                session_id,
                message_id: String::new(),
                index,
                text,
            }],
            ContentBlockDelta::ThinkingDelta { thinking } => {
                vec![NeigeEvent::AssistantThinkingDelta {
                    session_id,
                    message_id: String::new(),
                    index,
                    text: thinking,
                }]
            }
            ContentBlockDelta::InputJsonDelta { partial_json } => {
                vec![NeigeEvent::AssistantToolUseInputDelta {
                    session_id,
                    message_id: String::new(),
                    index,
                    partial_json,
                }]
            }
            // Signature deltas pad the thinking-block signature; they're
            // only useful for replay verification, so we drop them at the
            // unified layer. The raw layer still preserves them.
            ContentBlockDelta::SignatureDelta { .. } | ContentBlockDelta::Other => Vec::new(),
        },
        StreamEventInner::ContentBlockStop { index } => {
            vec![NeigeEvent::AssistantContentBlockStop {
                session_id,
                message_id: String::new(),
                index,
            }]
        }
        StreamEventInner::MessageDelta { delta, usage } => {
            let stop_reason = string_field(&delta, "stop_reason");
            vec![NeigeEvent::AssistantMessageDelta {
                session_id,
                message_id: String::new(),
                stop_reason,
                usage,
            }]
        }
        StreamEventInner::MessageStop => vec![NeigeEvent::AssistantMessageStop {
            session_id,
            message_id: String::new(),
        }],
        StreamEventInner::Other => Vec::new(),
    }
}

fn map_assistant_checkpoint(ev: AssistantCheckpointEvent) -> Vec<NeigeEvent> {
    let Some(session_id) = parse_session_id(&ev.session_id) else {
        return Vec::new();
    };
    vec![NeigeEvent::AssistantCheckpoint {
        session_id,
        message: ev.message,
    }]
}

fn map_user(ev: UserEvent) -> Vec<NeigeEvent> {
    let Some(session_id) = parse_session_id(&ev.session_id) else {
        return Vec::new();
    };
    match ev.message.content {
        UserContent::Text(text) => vec![NeigeEvent::UserMessage {
            session_id,
            content: vec![ContentBlock::Text { text }],
        }],
        UserContent::Blocks(blocks) => {
            // Two cases:
            //   1. Synthesized tool_result wrapper — emit one ToolResult
            //      event per tool_result block, drop everything else.
            //   2. Real user message with structured content (rare in
            //      stream-json today but possible) — emit a UserMessage
            //      with the parsed blocks.
            // We distinguish by checking whether *any* block is a
            // tool_result. If so we treat the whole message as a
            // tool-result wrapper (matches observed CLI behavior).
            let has_tool_result = blocks
                .iter()
                .any(|b| b.get("type").and_then(|v| v.as_str()) == Some("tool_result"));
            if has_tool_result {
                blocks
                    .into_iter()
                    .filter_map(|b| match parse_content_block(b) {
                        ContentBlock::ToolResult {
                            tool_use_id,
                            content,
                            is_error,
                        } => Some(NeigeEvent::ToolResult {
                            session_id,
                            tool_use_id,
                            content,
                            is_error,
                        }),
                        _ => None,
                    })
                    .collect()
            } else {
                let parsed: Vec<ContentBlock> =
                    blocks.into_iter().map(parse_content_block).collect();
                vec![NeigeEvent::UserMessage {
                    session_id,
                    content: parsed,
                }]
            }
        }
    }
}

fn map_result(ev: ResultEvent) -> Vec<NeigeEvent> {
    let Some(session_id) = parse_session_id(&ev.session_id) else {
        return Vec::new();
    };
    vec![NeigeEvent::Result {
        session_id,
        subtype: ev.subtype,
        is_error: ev.is_error,
        duration_ms: ev.duration_ms,
        total_cost_usd: ev.total_cost_usd,
        terminal_reason: ev.terminal_reason,
        permission_denials: ev.permission_denials,
    }]
}

// -- helpers -----------------------------------------------------------------

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(str::to_owned)
}

/// Convert a raw content-block JSON value into our unified [`ContentBlock`].
///
/// Falls back to [`ContentBlock::Unknown`] for any block type we don't
/// model so callers never lose data.
pub(crate) fn parse_content_block(value: Value) -> ContentBlock {
    let ty = value
        .get("type")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .unwrap_or_default();
    match ty.as_str() {
        "text" => {
            let text = string_field(&value, "text").unwrap_or_default();
            ContentBlock::Text { text }
        }
        "thinking" => {
            let thinking = string_field(&value, "thinking").unwrap_or_default();
            ContentBlock::Thinking { thinking }
        }
        "tool_use" => {
            let id = string_field(&value, "id").unwrap_or_default();
            let name = string_field(&value, "name").unwrap_or_default();
            let input = value
                .get("input")
                .cloned()
                .unwrap_or(Value::Object(Default::default()));
            ContentBlock::ToolUse { id, name, input }
        }
        "tool_result" => {
            let tool_use_id = string_field(&value, "tool_use_id").unwrap_or_default();
            let is_error = value
                .get("is_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let content = match value.get("content") {
                Some(Value::String(s)) => ToolResultContent::Text(s.clone()),
                Some(Value::Array(arr)) => ToolResultContent::Blocks(
                    arr.iter().cloned().map(parse_content_block).collect(),
                ),
                Some(other) => ToolResultContent::Text(other.to_string()),
                None => ToolResultContent::Text(String::new()),
            };
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            }
        }
        "image" => {
            let source = value
                .get("source")
                .cloned()
                .unwrap_or(Value::Object(Default::default()));
            ContentBlock::Image { source }
        }
        other => ContentBlock::Unknown {
            type_name: other.to_owned(),
            value,
        },
    }
}
