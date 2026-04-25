/*
 * Folds a flat NeigeEvent[] into a structured ChatTimeline that maps directly
 * to bubble/tool-card UI. Defensive on malformed/out-of-order input — we drop
 * orphan deltas rather than throw, so the UI never blanks on a partial stream.
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

export function deriveTimeline(events: NeigeEvent[]): DeriveResult {
  const timeline: ChatTimeline = {
    init: null,
    status: null,
    messages: [],
    passthroughs: [],
    result: null,
  };
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
