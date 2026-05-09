// Convert a Claude CLI session jsonl (the file at
// `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) into a NeigeEvent[]
// that `deriveTimeline` can fold into a `ChatTimeline`.
//
// The on-disk schema differs from the live stream-json events that NeigeEvent
// mirrors:
//   - Each line is one of: permission-mode | file-history-snapshot | user |
//     assistant | attachment | (occasionally other system-level entries).
//   - `user` lines carry message.content as either a string (plain user text)
//     or an array of content blocks (most often a single tool_result block
//     emitted as a follow-up to a tool_use).
//   - `assistant` lines carry message.content as an array of blocks
//     (text / thinking / tool_use). One assistant turn is logged as MULTIPLE
//     lines that share the same `message.id` — each line typically carries a
//     single block. We coalesce by id and synthesize one start/stop envelope
//     per turn so deriveTimeline sees a well-formed assistant message.
//
// Block discriminators (text / thinking / tool_use / tool_result / image) match
// `ContentBlock` in chat/types.ts exactly, so block-level shape is identity.
// Sidechain entries (`isSidechain: true` — Task tool sub-agents) are skipped;
// they don't belong in the user-visible timeline.

import type { ContentBlock, NeigeEvent } from './types';

interface RawAssistantLine {
  type: 'assistant';
  isSidechain?: boolean;
  message: {
    id: string;
    model?: string;
    role?: string;
    content?: ContentBlock[];
    stop_reason?: string | null;
    usage?: unknown;
  };
}

interface RawUserLine {
  type: 'user';
  isSidechain?: boolean;
  message: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

const SKIP_TYPES = new Set([
  'permission-mode',
  'file-history-snapshot',
  'attachment',
  'summary',
  'system',
]);

/**
 * Parse newline-delimited JSON, tolerating trailing newlines and the
 * occasional malformed line. Malformed lines are dropped silently — the
 * Claude CLI is the source of truth and it's append-only, so we never
 * "fix" the file.
 */
function parseJsonl(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Drop unparseable line.
    }
  }
  return out;
}

/**
 * Reduce a Claude CLI session jsonl to a NeigeEvent[] suitable for
 * `deriveTimeline`. Pure function — does no IO.
 */
export function jsonlToEvents(text: string): NeigeEvent[] {
  const lines = parseJsonl(text);
  const events: NeigeEvent[] = [];

  // Coalesce assistant lines that share a `message.id` into a single
  // start/blocks/stop envelope. Map preserves first-seen order, which
  // matches the wall-clock order we want in the rendered timeline.
  const assistantGroups = new Map<
    string,
    {
      model: string;
      blocks: ContentBlock[];
      stopReason: string | null;
      usage: unknown;
      // The index in `events` where this group's `assistant_message_start`
      // event should sit. We materialize the envelope lazily once we see the
      // first content block, then patch in subsequent blocks at that anchor.
      firstSeenIndex: number;
    }
  >();

  for (const raw of lines) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const type = entry.type;
    if (typeof type !== 'string') continue;
    if (SKIP_TYPES.has(type)) continue;
    if (entry.isSidechain === true) continue;

    if (type === 'user') {
      handleUserLine(entry as unknown as RawUserLine, events);
    } else if (type === 'assistant') {
      handleAssistantLine(entry as unknown as RawAssistantLine, events, assistantGroups);
    }
    // Unknown line types: ignore. The jsonl format is open-ended.
  }

  // Close every assistant group with a synthesized message_stop so
  // deriveTimeline marks blocks as no-longer-streaming.
  for (const [id] of assistantGroups) {
    events.push({ type: 'assistant_message_stop', session_id: '', message_id: id });
  }

  return events;
}

function handleUserLine(line: RawUserLine, events: NeigeEvent[]): void {
  const content = line.message?.content;
  if (typeof content === 'string') {
    if (!content) return;
    events.push({
      type: 'user_message',
      session_id: '',
      content: [{ type: 'text', text: content }],
    });
    return;
  }
  if (!Array.isArray(content)) return;

  // A user line whose only blocks are tool_results is a tool-result
  // delivery (the Anthropic API requires tool_results be wrapped in a
  // user-role message). Surface each as a tool_result event so
  // deriveTimeline pairs them with their tool_use sibling.
  const toolResults = content.filter(
    (b): b is Extract<ContentBlock, { type: 'tool_result' }> =>
      !!b && typeof b === 'object' && (b as ContentBlock).type === 'tool_result',
  );
  const others = content.filter((b) => b && (b as ContentBlock).type !== 'tool_result');

  for (const r of toolResults) {
    events.push({
      type: 'tool_result',
      session_id: '',
      tool_use_id: r.tool_use_id,
      content: r.content,
      is_error: r.is_error,
    });
  }

  if (others.length > 0) {
    events.push({
      type: 'user_message',
      session_id: '',
      content: others as ContentBlock[],
    });
  }
}

function handleAssistantLine(
  line: RawAssistantLine,
  events: NeigeEvent[],
  groups: Map<
    string,
    {
      model: string;
      blocks: ContentBlock[];
      stopReason: string | null;
      usage: unknown;
      firstSeenIndex: number;
    }
  >,
): void {
  const id = line.message?.id;
  if (!id) return;
  const blocks = line.message.content ?? [];
  const model = line.message.model ?? 'unknown';

  let group = groups.get(id);
  if (!group) {
    // Synthesize a `message_start` so deriveTimeline registers the assistant
    // bubble before any content blocks land in it.
    events.push({
      type: 'assistant_message_start',
      session_id: '',
      message_id: id,
      model,
      parent_tool_use_id: null,
    });
    group = {
      model,
      blocks: [],
      stopReason: null,
      usage: null,
      firstSeenIndex: events.length - 1,
    };
    groups.set(id, group);
  }

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const index = group.blocks.length;
    group.blocks.push(block);
    events.push({
      type: 'assistant_content_block_start',
      session_id: '',
      message_id: id,
      index,
      block,
    });
    events.push({
      type: 'assistant_content_block_stop',
      session_id: '',
      message_id: id,
      index,
    });
  }

  // Each line carries the latest stop_reason / usage; keep the most recent.
  if (line.message.stop_reason !== undefined) {
    group.stopReason = line.message.stop_reason ?? null;
  }
  if (line.message.usage !== undefined) {
    group.usage = line.message.usage;
  }
  // Emit a fresh delta with the latest stop_reason/usage. deriveTimeline
  // overwrites on each delta, so trailing one wins.
  events.push({
    type: 'assistant_message_delta',
    session_id: '',
    message_id: id,
    stop_reason: group.stopReason,
    usage: group.usage,
  });
}
