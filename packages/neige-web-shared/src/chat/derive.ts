/*
 * Folds a flat NeigeEvent[] into a structured ChatTimeline that maps directly
 * to bubble/tool-card UI. Defensive on malformed/out-of-order input — we drop
 * orphan deltas rather than throw, so the UI never blanks on a partial stream.
 *
 * Sub-agents (events with `parent_tool_use_id != null`) live on their own
 * recursive `ChatTimeline` attached under the parent Task's tool-use id. The
 * pipeline is two-stage:
 *
 *   1. `bucketByParent` partitions the event stream by the `parent_tool_use_id`
 *      each event belongs to. Events that don't carry the field explicitly
 *      inherit it via the `assistant_message_start` that opened their stream
 *      (or, for empty-message_id deltas, via the most recent stream we saw).
 *   2. `buildSingleTimeline` runs the original reducer on each bucket
 *      independently — same code, no per-bucket special cases.
 *
 * Then sub-agent timelines are attached under whichever timeline contains the
 * matching `tool_use` block (root or another sub-agent), so nested Task calls
 * fan out as a tree without any extra plumbing.
 */

import type {
  ContentBlock,
  NeigeEvent,
  ToolResultContent,
} from './types';

export interface SessionInit {
  sessionId: string;
  model: string;
  permissionMode: string;
  cwd: string;
  version: string;
  tools: string[];
}

export interface Result {
  subtype: string;
  isError: boolean;
  durationMs: number;
  totalCostUsd: number;
  terminalReason: string;
}

export type AssistantBlock =
  | { type: 'text'; index: number; text: string; isStreaming: boolean }
  | { type: 'thinking'; index: number; text: string; isStreaming: boolean }
  | {
      type: 'tool_use';
      index: number;
      toolUseId: string;
      name: string;
      input: unknown;
      partialJsonAccum: string;
      isStreaming: boolean;
    }
  | { type: 'unknown'; index: number; raw: unknown };

export type ChatMessage =
  | { role: 'user'; id: string; blocks: ContentBlock[] }
  | {
      role: 'assistant';
      id: string;
      messageId: string;
      model: string;
      blocks: AssistantBlock[];
      usage: unknown;
      stopReason: string | null;
      isComplete: boolean;
    };

export interface PassthroughEntry {
  id: string;
  kind: string;
  payload: unknown;
  insertedAfterMessageIndex: number | null;
}

export interface ChatTimeline {
  init: SessionInit | null;
  status: string | null;
  messages: ChatMessage[];
  passthroughs: PassthroughEntry[];
  result: Result | null;
  /**
   * Sub-agent timelines spawned by `Task` tool calls in this conversation.
   * Keyed by the parent Task block's `tool_use_id` — the renderer pulls the
   * matching entry out and attaches it inside the Task tool card. Recursive:
   * a sub-agent that itself spawns Task gets its own non-empty `subagents`.
   */
  subagents: Record<string, ChatTimeline>;
}

export interface ToolResultEntry {
  content: ToolResultContent;
  isError: boolean;
}

export type ToolResultsById = Record<string, ToolResultEntry>;

export interface DeriveResult {
  timeline: ChatTimeline;
  toolResults: ToolResultsById;
}

let userMsgCounter = 0;

function genUserId(): string {
  userMsgCounter += 1;
  return `user-${userMsgCounter}`;
}

function emptyTimeline(): ChatTimeline {
  return {
    init: null,
    status: null,
    messages: [],
    passthroughs: [],
    result: null,
    subagents: {},
  };
}

function lastAssistant(messages: ChatMessage[]):
  | (Extract<ChatMessage, { role: 'assistant' }> & { role: 'assistant' })
  | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'assistant') return m;
  }
  return null;
}

function findAssistantById(
  messages: ChatMessage[],
  messageId: string,
): Extract<ChatMessage, { role: 'assistant' }> | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'assistant' && m.messageId === messageId) return m;
  }
  return null;
}

/**
 * Mid-stream events from the Rust mapper carry an empty `message_id`
 * (the wire only puts the id on `message_start`; deltas/stops/etc. don't
 * repeat it). Resolve to the most-recent assistant message in that case.
 * If a real id IS present, use the strict id match first.
 */
function resolveAssistant(
  messages: ChatMessage[],
  messageId: string,
): Extract<ChatMessage, { role: 'assistant' }> | null {
  if (messageId) {
    const exact = findAssistantById(messages, messageId);
    if (exact) return exact;
  }
  return lastAssistant(messages);
}

function blockFromContentBlock(index: number, block: ContentBlock): AssistantBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', index, text: block.text, isStreaming: true };
    case 'thinking':
      return { type: 'thinking', index, text: block.thinking, isStreaming: true };
    case 'tool_use':
      return {
        type: 'tool_use',
        index,
        toolUseId: block.id,
        name: block.name,
        input: block.input,
        partialJsonAccum: '',
        isStreaming: true,
      };
    default:
      return { type: 'unknown', index, raw: block };
  }
}

/**
 * Partition `events` into per-parent_tool_use_id buckets.
 *
 * The mapping rules:
 *   - `assistant_message_start.parent_tool_use_id` is the source of truth for
 *     a given message's stream membership. We index every non-empty
 *     `message_id` to its parent so subsequent deltas can look it up.
 *   - `user_message` and `tool_result` carry their own `parent_tool_use_id`
 *     (added in this refactor — `undefined` falls back to root).
 *   - Mid-stream deltas usually arrive with `message_id=''`. They inherit the
 *     parent of the most recent stream-establishing event (`message_start`,
 *     `user_message`, or `tool_result`) — same heuristic the original
 *     reducer used to find the owning assistant message.
 *   - Stream-wide events (`session_init`, `status_change`, `result`,
 *     `passthrough`, `assistant_checkpoint`, `rate_limit`) always land at root.
 *     The SDK doesn't scope them per-sub-agent today; revisit if that changes.
 */
function bucketByParent(events: NeigeEvent[]): Map<string | null, NeigeEvent[]> {
  // Pass 1: messageId → parent map for resolved-by-id lookups.
  const messageParent = new Map<string, string | null>();
  for (const ev of events) {
    if (ev.type === 'assistant_message_start' && ev.message_id) {
      messageParent.set(ev.message_id, ev.parent_tool_use_id);
    }
  }

  const buckets = new Map<string | null, NeigeEvent[]>();
  let currentStreamParent: string | null = null;

  const push = (parent: string | null, ev: NeigeEvent) => {
    let arr = buckets.get(parent);
    if (!arr) {
      arr = [];
      buckets.set(parent, arr);
    }
    arr.push(ev);
  };

  for (const ev of events) {
    let parent: string | null = null;

    switch (ev.type) {
      case 'assistant_message_start':
        parent = ev.parent_tool_use_id;
        currentStreamParent = parent;
        break;
      case 'user_message':
        parent = ev.parent_tool_use_id ?? null;
        currentStreamParent = parent;
        break;
      case 'tool_result':
        parent = ev.parent_tool_use_id ?? null;
        // Update the streaming context too: a tool_result closes one
        // turn-cycle and the next assistant_message_start (with its own
        // parent) will overwrite this anyway. Keeping them in sync means
        // a stray empty-message_id event between turns lands sensibly.
        currentStreamParent = parent;
        break;
      case 'assistant_content_block_start':
      case 'assistant_text_delta':
      case 'assistant_thinking_delta':
      case 'assistant_tool_use_input_delta':
      case 'assistant_content_block_stop':
      case 'assistant_message_delta':
      case 'assistant_message_stop': {
        if (ev.message_id && messageParent.has(ev.message_id)) {
          parent = messageParent.get(ev.message_id) ?? null;
        } else {
          parent = currentStreamParent;
        }
        break;
      }
      case 'session_init':
      case 'status_change':
      case 'result':
      case 'passthrough':
      case 'rate_limit':
      case 'assistant_checkpoint':
      default:
        // Stream-wide / not-yet-bucketed → root.
        parent = null;
        break;
    }

    push(parent, ev);
  }

  return buckets;
}

/**
 * Reduce a single bucket of events into one ChatTimeline. Identical to the
 * pre-refactor reducer body — just lifted out so we can run it on every
 * bucket independently. Sub-agents' timelines are attached afterwards by
 * `deriveTimeline`.
 */
function buildSingleTimeline(events: NeigeEvent[]): DeriveResult {
  const timeline = emptyTimeline();
  const toolResults: ToolResultsById = {};
  let passthroughCounter = 0;

  for (const ev of events) {
    switch (ev.type) {
      case 'session_init': {
        timeline.init = {
          sessionId: ev.session_id,
          model: ev.model,
          permissionMode: ev.permission_mode,
          cwd: ev.cwd,
          version: ev.version,
          tools: ev.tools,
        };
        break;
      }
      case 'status_change': {
        timeline.status = ev.status;
        break;
      }
      case 'user_message': {
        timeline.messages.push({
          role: 'user',
          id: genUserId(),
          blocks: ev.content,
        });
        break;
      }
      case 'assistant_message_start': {
        timeline.messages.push({
          role: 'assistant',
          id: ev.message_id,
          messageId: ev.message_id,
          model: ev.model,
          blocks: [],
          usage: null,
          stopReason: null,
          isComplete: false,
        });
        break;
      }
      case 'assistant_content_block_start': {
        const msg = resolveAssistant(timeline.messages, ev.message_id);
        if (!msg) break;
        msg.blocks.push(blockFromContentBlock(ev.index, ev.block));
        break;
      }
      case 'assistant_text_delta': {
        const msg = resolveAssistant(timeline.messages, ev.message_id);
        if (!msg) break;
        const block = msg.blocks.find((b) => b.index === ev.index);
        if (block && block.type === 'text') {
          block.text += ev.text;
        } else if (!block) {
          msg.blocks.push({
            type: 'text',
            index: ev.index,
            text: ev.text,
            isStreaming: true,
          });
        }
        break;
      }
      case 'assistant_thinking_delta': {
        const msg = resolveAssistant(timeline.messages, ev.message_id);
        if (!msg) break;
        const block = msg.blocks.find((b) => b.index === ev.index);
        if (block && block.type === 'thinking') {
          block.text += ev.text;
        } else if (!block) {
          msg.blocks.push({
            type: 'thinking',
            index: ev.index,
            text: ev.text,
            isStreaming: true,
          });
        }
        break;
      }
      case 'assistant_tool_use_input_delta': {
        const msg = resolveAssistant(timeline.messages, ev.message_id);
        if (!msg) break;
        const block = msg.blocks.find((b) => b.index === ev.index);
        if (block && block.type === 'tool_use') {
          block.partialJsonAccum += ev.partial_json;
          try {
            block.input = JSON.parse(block.partialJsonAccum);
          } catch {
            // partial — keep last successful parse
          }
        }
        break;
      }
      case 'assistant_content_block_stop': {
        const msg = resolveAssistant(timeline.messages, ev.message_id);
        if (!msg) break;
        const block = msg.blocks.find((b) => b.index === ev.index);
        if (block && block.type !== 'unknown') {
          block.isStreaming = false;
        }
        break;
      }
      case 'assistant_message_delta': {
        const msg = resolveAssistant(timeline.messages, ev.message_id);
        if (!msg) break;
        msg.usage = ev.usage;
        msg.stopReason = ev.stop_reason;
        break;
      }
      case 'assistant_message_stop': {
        const msg = resolveAssistant(timeline.messages, ev.message_id);
        if (!msg) break;
        msg.isComplete = true;
        for (const b of msg.blocks) {
          if (b.type !== 'unknown') b.isStreaming = false;
        }
        break;
      }
      case 'tool_result': {
        toolResults[ev.tool_use_id] = {
          content: ev.content,
          isError: ev.is_error,
        };
        break;
      }
      case 'result': {
        timeline.result = {
          subtype: ev.subtype,
          isError: ev.is_error,
          durationMs: ev.duration_ms,
          totalCostUsd: ev.total_cost_usd,
          terminalReason: ev.terminal_reason,
        };
        break;
      }
      case 'passthrough': {
        const idx = timeline.messages.length - 1;
        timeline.passthroughs.push({
          id: `passthrough-${passthroughCounter}`,
          kind: ev.kind,
          payload: ev.payload,
          insertedAfterMessageIndex: idx >= 0 ? idx : null,
        });
        passthroughCounter += 1;
        break;
      }
      case 'assistant_checkpoint':
      case 'rate_limit':
      default:
        break;
    }
  }

  return { timeline, toolResults };
}

/**
 * Look across all built timelines for the one whose assistant messages
 * contain a `tool_use` block matching `toolUseId`. That's the timeline the
 * sub-agent should attach to. Returns null if no host is found (e.g. the
 * parent Task block was truncated out of the event window).
 */
function findHostTimeline(
  built: Map<string | null, ChatTimeline>,
  toolUseId: string,
): ChatTimeline | null {
  for (const timeline of built.values()) {
    for (const msg of timeline.messages) {
      if (msg.role !== 'assistant') continue;
      for (const block of msg.blocks) {
        if (block.type === 'tool_use' && block.toolUseId === toolUseId) {
          return timeline;
        }
      }
    }
  }
  return null;
}

export function deriveTimeline(events: NeigeEvent[]): DeriveResult {
  const buckets = bucketByParent(events);

  // Build each bucket as its own self-contained timeline. Sub-agents are
  // attached afterwards once we know which timeline holds the matching
  // tool_use block — that lookup needs every bucket to be built first so
  // nested Task chains resolve in any order.
  const built = new Map<string | null, ChatTimeline>();
  const allToolResults: ToolResultsById = {};

  for (const [parentId, evs] of buckets) {
    const { timeline, toolResults } = buildSingleTimeline(evs);
    built.set(parentId, timeline);
    Object.assign(allToolResults, toolResults);
  }

  const root = built.get(null) ?? emptyTimeline();
  // Ensure the root entry is in the map even when no events were null-bucketed,
  // so attachment-target lookup below can still find it as a fallback.
  if (!built.has(null)) built.set(null, root);

  for (const [parentId, sub] of built) {
    if (parentId === null) continue;
    const host = findHostTimeline(built, parentId) ?? root;
    host.subagents[parentId] = sub;
  }

  return { timeline: root, toolResults: allToolResults };
}
