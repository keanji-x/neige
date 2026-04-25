//! End-to-end fixture tests for the stream-json parser + mapper.
//!
//! Fixtures under `tests/fixtures/stream_json/` were captured from real
//! `claude --output-format=stream-json` runs and are the ground truth for
//! schema decisions in this module.

use neige_session::stream_json::{
    ContentBlock, NeigeEvent, RawStreamJsonEvent, ToolResultContent, parse_line, to_neige_events,
};
use uuid::Uuid;

const TRIVIAL: &str = include_str!("fixtures/stream_json/trivial.ndjson");
const WITH_TOOL_USE: &str = include_str!("fixtures/stream_json/with_tool_use.ndjson");

fn parse_all(ndjson: &str) -> Vec<NeigeEvent> {
    let mut out = Vec::new();
    for (i, line) in ndjson.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let raw =
            parse_line(line).unwrap_or_else(|e| panic!("failed to parse line {}: {e}", i + 1));
        out.extend(to_neige_events(raw));
    }
    out
}

#[test]
fn test_parse_trivial_fixture() {
    let events = parse_all(TRIVIAL);

    assert!(
        events
            .iter()
            .any(|e| matches!(e, NeigeEvent::SessionInit { .. })),
        "expected at least one SessionInit event"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, NeigeEvent::AssistantTextDelta { .. })),
        "expected at least one AssistantTextDelta event"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, NeigeEvent::Result { .. })),
        "expected at least one Result event"
    );

    // Sanity: the text deltas should reconstruct "hello world".
    let text: String = events
        .iter()
        .filter_map(|e| match e {
            NeigeEvent::AssistantTextDelta { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "hello world");
}

#[test]
fn test_parse_tool_use_fixture() {
    let events = parse_all(WITH_TOOL_USE);

    assert!(
        events.iter().any(|e| matches!(
            e,
            NeigeEvent::AssistantContentBlockStart {
                block: ContentBlock::ToolUse { .. },
                ..
            }
        )),
        "expected at least one AssistantContentBlockStart with a ToolUse block"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, NeigeEvent::AssistantToolUseInputDelta { .. })),
        "expected at least one AssistantToolUseInputDelta event"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, NeigeEvent::ToolResult { .. })),
        "expected at least one ToolResult event"
    );

    // Sanity: the input_json deltas should reconstruct the call payload.
    let partial: String = events
        .iter()
        .filter_map(|e| match e {
            NeigeEvent::AssistantToolUseInputDelta { partial_json, .. } => {
                Some(partial_json.as_str())
            }
            _ => None,
        })
        .collect();
    assert_eq!(partial, r#"{"file_path": "/etc/hostname"}"#);
}

#[test]
fn test_unknown_top_level_type_does_not_error() {
    let line = r#"{"type":"future_thing","foo":42}"#;
    let raw = parse_line(line).expect("unknown top-level type must parse, not error");
    assert!(
        matches!(raw, RawStreamJsonEvent::Unknown(_)),
        "expected Unknown variant for unknown type, got: {raw:?}"
    );
    let mapped = to_neige_events(raw);
    assert!(
        mapped.is_empty(),
        "unknown event must produce zero NeigeEvents"
    );
}

#[test]
fn test_neige_event_wire_shape_session_init() {
    // Wire contract test: the frontend deserializes these objects with the
    // discriminator at `type` and snake_case variant names. Locking it in
    // here so a future serde rename can't silently break the WS protocol.
    let ev = NeigeEvent::SessionInit {
        session_id: Uuid::nil(),
        model: "claude-opus-4-7".into(),
        permission_mode: "auto".into(),
        cwd: "/tmp".into(),
        version: "2.1.119".into(),
        tools: vec!["Bash".into()],
        mcp_servers: vec![],
        slash_commands: vec![],
        agents: vec![],
        skills: vec![],
        plugins: vec![],
    };
    let s = serde_json::to_string(&ev).expect("serialize");
    assert!(s.contains(r#""type":"session_init""#), "wrong tag: {s}");
    assert!(s.contains(r#""session_id":"00000000-0000-0000-0000-000000000000""#));
    assert!(s.contains(r#""tools":["Bash"]"#));
    assert!(s.contains(r#""permission_mode":"auto""#));
}

#[test]
fn test_neige_event_wire_shape_tool_use() {
    let ev = NeigeEvent::AssistantContentBlockStart {
        session_id: Uuid::nil(),
        message_id: "msg_1".into(),
        index: 0,
        block: ContentBlock::ToolUse {
            id: "toolu_1".into(),
            name: "Read".into(),
            input: serde_json::json!({"file_path": "/etc/hostname"}),
        },
    };
    let s = serde_json::to_string(&ev).expect("serialize");
    assert!(s.contains(r#""type":"assistant_content_block_start""#));
    // Inner ContentBlock also tagged on `type`.
    assert!(s.contains(r#""type":"tool_use""#));
    assert!(s.contains(r#""name":"Read""#));
    assert!(s.contains(r#""file_path":"/etc/hostname""#));
}

#[test]
fn test_tool_result_content_is_untagged() {
    // ToolResultContent is untagged on the wire (matches Anthropic API):
    // text → bare string, blocks → bare array. Frontend must reflect this.
    let s = serde_json::to_string(&ToolResultContent::Text("hi".into())).unwrap();
    assert_eq!(s, r#""hi""#);

    let s = serde_json::to_string(&ToolResultContent::Blocks(vec![ContentBlock::Text {
        text: "x".into(),
    }]))
    .unwrap();
    assert_eq!(s, r#"[{"type":"text","text":"x"}]"#);
}

#[test]
fn test_unknown_field_in_known_type_does_not_error() {
    // `system / status` event with a bogus extra field tacked on.
    let line = r#"{"type":"system","subtype":"status","status":"requesting","uuid":"00000000-0000-0000-0000-000000000000","session_id":"11111111-1111-1111-1111-111111111111","brand_new_field":{"nested":true}}"#;
    let raw = parse_line(line).expect("unknown extra field must not break parsing");
    let mapped = to_neige_events(raw);
    assert_eq!(mapped.len(), 1);
    assert!(matches!(&mapped[0], NeigeEvent::StatusChange { status, .. } if status == "requesting"));
}
