//! Parser + mapper for Claude Code's `--output-format=stream-json` NDJSON.
//!
//! [`parse_line`] turns a single NDJSON line into a [`RawStreamJsonEvent`]
//! that mirrors the wire shape (with an `Unknown` fallback for forward
//! compatibility). [`to_neige_events`] then translates a raw event into zero
//! or more [`NeigeEvent`]s, the stable internal contract that the rest of
//! neige consumes regardless of which source produced the events
//! (stream-json today, JSONL tail tomorrow).

pub mod map;
pub mod raw;
pub mod unified;

pub use map::to_neige_events;
pub use raw::{ParseError, RawStreamJsonEvent, parse_line};
pub use unified::{ContentBlock, McpServerInfo, NeigeEvent, PluginInfo, ToolResultContent};
