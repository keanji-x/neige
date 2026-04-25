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
const WITH_HOOKS: &str = include_str!("fixtures/stream_json/with_hooks.ndjson");

fn parse_all(ndjson: &str) -> Vec<NeigeEvent> {
    let mut out = Vec::new();
    for (i, line) in ndjson.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let (raw, original) =
            parse_line(line).unwrap_or_else(|e| panic!("failed to parse line {}: {e}", i + 1));
        out.extend(to_neige_events(raw, original));
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
    // Unknown event with no session_id: drops silently (we can't address it).
    let line = r#"{"type":"future_thing","foo":42}"#;
    let (raw, original) = parse_line(line).expect("unknown top-level type must parse, not error");
    assert!(
        matches!(raw, RawStreamJsonEvent::Unknown(_)),
        "expected Unknown variant for unknown type, got: {raw:?}"
    );
    let mapped = to_neige_events(raw, original);
    assert!(
        mapped.is_empty(),
        "unknown event without session_id must produce zero NeigeEvents"
    );
}

#[test]
fn test_unknown_top_level_type_with_session_id_passthroughs() {
    // Unknown event WITH session_id: surfaces as a Passthrough so the
    // frontend can pattern-match on `kind`.
    let line = r#"{"type":"future_thing","session_id":"11111111-1111-1111-1111-111111111111","foo":42}"#;
    let (raw, original) = parse_line(line).expect("must parse");
    assert!(matches!(raw, RawStreamJsonEvent::Unknown(_)));
    let mapped = to_neige_events(raw, original);
    assert_eq!(mapped.len(), 1);
    match &mapped[0] {
        NeigeEvent::Passthrough {
            session_id,
            kind,
            payload,
        } => {
            assert_eq!(session_id.to_string(), "11111111-1111-1111-1111-111111111111");
            assert_eq!(kind, "future_thing");
            assert_eq!(payload.get("foo").and_then(|v| v.as_u64()), Some(42));
        }
        other => panic!("expected Passthrough, got {other:?}"),
    }
}

#[test]
fn test_hook_events_passthrough_from_fixture() {
    // The captured fixture contains Pre/Post-ToolUse hook_started +
    // hook_response pairs. Each one must surface as a Passthrough
    // tagged `hook.<event_snake>.<phase>`.
    let events = parse_all(WITH_HOOKS);

    // SessionInit is still emitted from the typed path.
    assert!(
        events
            .iter()
            .any(|e| matches!(e, NeigeEvent::SessionInit { .. })),
        "expected SessionInit event from typed path"
    );

    let kinds: Vec<&str> = events
        .iter()
        .filter_map(|e| match e {
            NeigeEvent::Passthrough { kind, .. } => Some(kind.as_str()),
            _ => None,
        })
        .collect();

    // Exact pairing depends on the captured fixture; we just need
    // to see at least one started/response of each event.
    assert!(
        kinds.contains(&"hook.pre_tool_use.started"),
        "missing PreToolUse started kind, got: {kinds:?}"
    );
    assert!(
        kinds.contains(&"hook.pre_tool_use.response"),
        "missing PreToolUse response kind, got: {kinds:?}"
    );
    assert!(
        kinds.contains(&"hook.post_tool_use.started"),
        "missing PostToolUse started kind, got: {kinds:?}"
    );
    assert!(
        kinds.contains(&"hook.post_tool_use.response"),
        "missing PostToolUse response kind, got: {kinds:?}"
    );

    // Payload must be the verbatim JSON, including the verbose
    // hook_id / output / exit_code fields the frontend renders.
    let first_response = events
        .iter()
        .find(|e| {
            matches!(e,
                NeigeEvent::Passthrough { kind, .. } if kind == "hook.pre_tool_use.response")
        })
        .expect("at least one hook response");
    if let NeigeEvent::Passthrough { payload, .. } = first_response {
        assert_eq!(
            payload.get("type").and_then(|v| v.as_str()),
            Some("system")
        );
        assert_eq!(
            payload.get("subtype").and_then(|v| v.as_str()),
            Some("hook_response")
        );
        assert!(payload.get("hook_id").is_some(), "payload missing hook_id");
        assert!(payload.get("exit_code").is_some(), "payload missing exit_code");
    }
}

#[test]
fn test_hook_event_without_hook_event_field_falls_back() {
    // Defensive: a future hook subtype without `hook_event` set still
    // surfaces — we don't want to silently drop it.
    let line = r#"{"type":"system","subtype":"hook_started","session_id":"11111111-1111-1111-1111-111111111111"}"#;
    let (raw, original) = parse_line(line).expect("must parse");
    let mapped = to_neige_events(raw, original);
    assert_eq!(mapped.len(), 1);
    match &mapped[0] {
        NeigeEvent::Passthrough { kind, .. } => {
            assert_eq!(kind, "hook.started");
        }
        other => panic!("expected Passthrough, got {other:?}"),
    }
}

#[test]
fn test_neige_event_wire_shape_passthrough() {
    // Wire contract: Passthrough is tagged "passthrough" in snake_case
    // and round-trips losslessly via the JSON-Value form (which is what
    // the WS layer uses).
    let payload = serde_json::json!({"type":"system","subtype":"hook_started"});
    let ev = NeigeEvent::Passthrough {
        session_id: Uuid::nil(),
        kind: "hook.pre_tool_use.started".into(),
        payload: payload.clone(),
    };
    let v = serde_json::to_value(&ev).expect("serialize");
    assert_eq!(v.get("type").and_then(|x| x.as_str()), Some("passthrough"));
    assert_eq!(
        v.get("kind").and_then(|x| x.as_str()),
        Some("hook.pre_tool_use.started")
    );
    assert_eq!(v.get("payload"), Some(&payload));
    assert_eq!(
        v.get("session_id").and_then(|x| x.as_str()),
        Some("00000000-0000-0000-0000-000000000000")
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
    let (raw, original) = parse_line(line).expect("unknown extra field must not break parsing");
    let mapped = to_neige_events(raw, original);
    assert_eq!(mapped.len(), 1);
    assert!(matches!(&mapped[0], NeigeEvent::StatusChange { status, .. } if status == "requesting"));
}
