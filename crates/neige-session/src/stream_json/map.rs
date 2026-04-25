//! Translate [`RawStreamJsonEvent`] into one or more [`NeigeEvent`]s.
//!
//! The mapping is intentionally lossy in places — we keep raw `Value`
//! payloads where the frontend needs richer detail than we want to model
//! in Rust (rate limits, message_delta usage, etc) and we route anything
//! we don't recognize through [`NeigeEvent::Passthrough`] so the frontend
//! can still observe new event shapes Claude introduces (hook events,
//! future top-level types, new system subtypes, …) without us having to
//! ripple a typed variant through every layer.

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
/// `original` is the verbatim JSON the line parsed from. We need it to
/// build [`NeigeEvent::Passthrough`] for fall-through paths (unknown
/// top-level types, unknown system subtypes, hook events, unknown inner
/// stream events) — re-serializing the typed parse would lose
/// forward-compatibility fields that the frontend may still want.
///
/// One raw event can fan out to multiple unified events — most notably a
/// synthesized user-tool_result message produces one [`NeigeEvent::ToolResult`]
/// per `tool_result` block in its content array.
pub fn to_neige_events(raw: RawStreamJsonEvent, original: Value) -> Vec<NeigeEvent> {
    match raw {
        RawStreamJsonEvent::System(SystemEvent::Init(init)) => map_system_init(init),
        RawStreamJsonEvent::System(SystemEvent::Status(status)) => map_system_status(status),
        RawStreamJsonEvent::System(SystemEvent::Other) => map_system_other_passthrough(original),
        RawStreamJsonEvent::RateLimit(ev) => map_rate_limit(ev),
        RawStreamJsonEvent::Stream(ev) => map_stream(ev, original),
        RawStreamJsonEvent::Assistant(ev) => map_assistant_checkpoint(ev),
        RawStreamJsonEvent::User(ev) => map_user(ev),
        RawStreamJsonEvent::Result(ev) => map_result(ev),
        RawStreamJsonEvent::Unknown(value) => map_unknown_passthrough(value),
    }
}

/// Convert `Pascal/CamelCase` to `snake_case` for stable hook discriminators.
///
/// Claude's wire emits `hook_event` values in PascalCase (`PreToolUse`,
/// `PostToolUse`, `UserPromptSubmit`, …). We snake-case them so the
/// frontend can pattern-match a single canonical form regardless of any
/// future capitalization drift.
fn pascal_to_snake(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if i != 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Pull `session_id` out of a top-level event JSON. Logs and returns `None`
/// if missing or not a Uuid — same convention as the typed paths.
fn session_id_from_value(value: &Value) -> Option<Uuid> {
    let s = value.get("session_id").and_then(|v| v.as_str())?;
    match Uuid::parse_str(s) {
        Ok(id) => Some(id),
        Err(_) => {
            tracing::debug!(session_id = %s, "stream_json: invalid uuid in passthrough");
            None
        }
    }
}

fn map_unknown_passthrough(value: Value) -> Vec<NeigeEvent> {
    let Some(session_id) = session_id_from_value(&value) else {
        tracing::debug!(?value, "stream_json: dropping unknown top-level (no session_id)");
        return Vec::new();
    };
    let kind = value
        .get("type")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| "unknown".to_owned());
    vec![NeigeEvent::Passthrough {
        session_id,
        kind,
        payload: value,
    }]
}

/// `system` event with a subtype we don't model. Hook events
/// (`subtype = "hook_started"` / `"hook_response"`) flow through here and
/// get a stable `hook.<event_snake>.<phase>` kind.
fn map_system_other_passthrough(value: Value) -> Vec<NeigeEvent> {
    let Some(session_id) = session_id_from_value(&value) else {
        tracing::debug!(?value, "stream_json: dropping system/other (no session_id)");
        return Vec::new();
    };
    let subtype = value
        .get("subtype")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let kind = match subtype {
        "hook_started" | "hook_response" => {
            let phase = if subtype == "hook_started" {
                "started"
            } else {
                "response"
            };
            // `hook_event` carries the PascalCase event name (PreToolUse,
            // PostToolUse, UserPromptSubmit, ...). Some future hook may
            // omit it — fall back to the subtype-only form so the frontend
            // still gets a Passthrough rather than a silent drop.
            match value.get("hook_event").and_then(|v| v.as_str()) {
                Some(name) if !name.is_empty() => {
                    format!("hook.{}.{}", pascal_to_snake(name), phase)
                }
                _ => format!("hook.{phase}"),
            }
        }
        other if !other.is_empty() => format!("system.{other}"),
        _ => "system.unknown".to_owned(),
    };
    vec![NeigeEvent::Passthrough {
        session_id,
        kind,
        payload: value,
    }]
}

/// Inner stream-event variant we don't model. `session_id` lives on the
/// wrapper, so we read it off the original Value here.
fn map_stream_other_passthrough(value: Value) -> Vec<NeigeEvent> {
    let Some(session_id) = session_id_from_value(&value) else {
        tracing::debug!(?value, "stream_json: dropping stream/other (no session_id)");
        return Vec::new();
    };
    let inner_kind = value
        .get("event")
        .and_then(|e| e.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    vec![NeigeEvent::Passthrough {
        session_id,
        kind: format!("stream_event.{inner_kind}"),
        payload: value,
    }]
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

fn map_stream(ev: StreamEventWrapper, original: Value) -> Vec<NeigeEvent> {
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
            // only useful for replay verification (and only the typed
            // raw layer needs them), so we drop them at the unified
            // layer. `Other` is a future delta we don't model — same
            // outcome: drop. We deliberately do NOT route these through
            // Passthrough because content_block_delta lacks a
            // session_id at this nesting level and emitting one
            // Passthrough per character of unknown delta would just
            // spam the stream.
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
        StreamEventInner::Other => map_stream_other_passthrough(original),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stream_json::parse_line;

    fn map_one(line: &str) -> Vec<NeigeEvent> {
        let (raw, original) = parse_line(line).expect("parse");
        to_neige_events(raw, original)
    }

    #[test]
    fn pascal_to_snake_basics() {
        assert_eq!(pascal_to_snake("PreToolUse"), "pre_tool_use");
        assert_eq!(pascal_to_snake("PostToolUse"), "post_tool_use");
        assert_eq!(pascal_to_snake("UserPromptSubmit"), "user_prompt_submit");
        assert_eq!(pascal_to_snake("Stop"), "stop");
        // already snake-case input should pass through.
        assert_eq!(pascal_to_snake("already_snake"), "already_snake");
    }

    #[test]
    fn hook_started_emits_passthrough_with_phase() {
        let line = r#"{"type":"system","subtype":"hook_started","hook_id":"h1","hook_name":"PreToolUse:Bash","hook_event":"PreToolUse","session_id":"11111111-1111-1111-1111-111111111111"}"#;
        let mapped = map_one(line);
        assert_eq!(mapped.len(), 1);
        match &mapped[0] {
            NeigeEvent::Passthrough { kind, payload, .. } => {
                assert_eq!(kind, "hook.pre_tool_use.started");
                assert_eq!(
                    payload.get("hook_id").and_then(|v| v.as_str()),
                    Some("h1")
                );
            }
            other => panic!("expected Passthrough, got {other:?}"),
        }
    }

    #[test]
    fn hook_response_emits_passthrough_with_phase() {
        let line = r#"{"type":"system","subtype":"hook_response","hook_id":"h2","hook_name":"PostToolUse:Bash","hook_event":"PostToolUse","output":"ok\n","exit_code":0,"outcome":"success","session_id":"11111111-1111-1111-1111-111111111111"}"#;
        let mapped = map_one(line);
        assert_eq!(mapped.len(), 1);
        match &mapped[0] {
            NeigeEvent::Passthrough { kind, payload, .. } => {
                assert_eq!(kind, "hook.post_tool_use.response");
                assert_eq!(
                    payload.get("exit_code").and_then(|v| v.as_i64()),
                    Some(0)
                );
            }
            other => panic!("expected Passthrough, got {other:?}"),
        }
    }

    #[test]
    fn unknown_top_level_with_session_id_passthroughs() {
        let line = r#"{"type":"future_thing","session_id":"11111111-1111-1111-1111-111111111111","x":1}"#;
        let mapped = map_one(line);
        assert_eq!(mapped.len(), 1);
        match &mapped[0] {
            NeigeEvent::Passthrough { kind, .. } => assert_eq!(kind, "future_thing"),
            other => panic!("expected Passthrough, got {other:?}"),
        }
    }

    #[test]
    fn unknown_top_level_without_session_id_drops() {
        let line = r#"{"type":"future_thing","x":1}"#;
        let mapped = map_one(line);
        assert!(mapped.is_empty());
    }

    #[test]
    fn unknown_system_subtype_passthroughs() {
        let line = r#"{"type":"system","subtype":"brand_new_subtype","session_id":"11111111-1111-1111-1111-111111111111"}"#;
        let mapped = map_one(line);
        assert_eq!(mapped.len(), 1);
        match &mapped[0] {
            NeigeEvent::Passthrough { kind, .. } => assert_eq!(kind, "system.brand_new_subtype"),
            other => panic!("expected Passthrough, got {other:?}"),
        }
    }

    #[test]
    fn unknown_inner_stream_event_passthroughs() {
        // StreamEventInner::Other path. session_id is on the wrapper.
        let line = r#"{"type":"stream_event","session_id":"11111111-1111-1111-1111-111111111111","event":{"type":"future_inner","data":1}}"#;
        let mapped = map_one(line);
        assert_eq!(mapped.len(), 1);
        match &mapped[0] {
            NeigeEvent::Passthrough { kind, .. } => assert_eq!(kind, "stream_event.future_inner"),
            other => panic!("expected Passthrough, got {other:?}"),
        }
    }

    #[test]
    fn signature_delta_still_drops_silently() {
        // Regression: we deliberately do NOT route signature deltas
        // through Passthrough — they're per-character noise.
        let line = r#"{"type":"stream_event","session_id":"11111111-1111-1111-1111-111111111111","event":{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}}"#;
        let mapped = map_one(line);
        assert!(mapped.is_empty(), "expected drop, got {mapped:?}");
    }
}
