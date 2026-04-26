/**
 * Translate `@anthropic-ai/claude-agent-sdk` `SDKMessage` values into
 * neige's wire `NeigeEvent` union.
 *
 * The mapping mirrors the existing Rust path
 * `crates/neige-session/src/stream_json/map.rs`. Anything we don't model
 * explicitly is forwarded as a `passthrough` event with a stable `kind`
 * discriminator and the original SDK payload — same convention as the
 * Rust Passthrough variant.
 *
 * Pure functions only — no I/O. The CLI is responsible for
 * serializing the returned events to stdout.
 */
import type { ContentBlock, NeigeEvent, ToolResultContent } from './types.js';

/**
 * Public entry point: take one SDK message and return zero or more
 * NeigeEvents to emit on the wire. Returns an array because some SDK
 * shapes (a synthesized user `tool_result` wrapper containing N
 * `tool_result` blocks) fan out to multiple events.
 *
 * `sessionId` is the CLI's `--session-id` flag, used as the
 * authoritative identifier for the session — every emitted event
 * stamps it. (We deliberately don't trust the SDK's own `session_id`
 * field on each message, because the daemon already routes WebSocket
 * traffic by the CLI flag.)
 */
export function mapSdkMessage(msg: unknown, sessionId: string): NeigeEvent[] {
  if (!isObject(msg)) return [];
  const type = stringField(msg, 'type');
  switch (type) {
    case 'system':
      return mapSystem(msg, sessionId);
    case 'stream_event':
      return mapStreamEvent(msg, sessionId);
    case 'assistant':
      return mapAssistantCheckpoint(msg, sessionId);
    case 'user':
      return mapUser(msg, sessionId);
    case 'result':
      return mapResult(msg, sessionId);
    case 'rate_limit_event':
      return mapRateLimit(msg, sessionId);
    default:
      // Unknown top-level type → passthrough with the original `type`
      // string as kind. Keeps forward-compat with new SDK shapes
      // without the runner needing a release.
      return [
        {
          type: 'passthrough',
          session_id: sessionId,
          kind: typeof type === 'string' && type.length > 0 ? type : 'unknown',
          payload: msg,
        },
      ];
  }
}

// ---- system ----------------------------------------------------------------

function mapSystem(msg: Record<string, unknown>, sessionId: string): NeigeEvent[] {
  const subtype = stringField(msg, 'subtype');
  switch (subtype) {
    case 'init':
      return [mapSystemInit(msg, sessionId)];
    case 'status':
      return mapSystemStatus(msg, sessionId);
    case 'hook_started':
      return [systemHookPassthrough(msg, sessionId, 'started')];
    case 'hook_response':
      return [systemHookPassthrough(msg, sessionId, 'response')];
    case 'hook_progress':
      // Not a phase in the Rust mapping — we still want it visible, so
      // pick a phase-like discriminator that mirrors the started/response
      // convention. Frontend treats it as opaque.
      return [systemHookPassthrough(msg, sessionId, 'progress')];
    default: {
      const kind =
        typeof subtype === 'string' && subtype.length > 0 ? `system.${subtype}` : 'system.unknown';
      return [
        {
          type: 'passthrough',
          session_id: sessionId,
          kind,
          payload: msg,
        },
      ];
    }
  }
}

function mapSystemInit(msg: Record<string, unknown>, sessionId: string): NeigeEvent {
  return {
    type: 'session_init',
    session_id: sessionId,
    model: stringField(msg, 'model') ?? '',
    permission_mode: stringField(msg, 'permissionMode') ?? stringField(msg, 'permission_mode') ?? '',
    cwd: stringField(msg, 'cwd') ?? '',
    version: stringField(msg, 'claude_code_version') ?? '',
    tools: stringArrayField(msg, 'tools'),
    mcp_servers: mcpServersField(msg),
    slash_commands: stringArrayField(msg, 'slash_commands'),
    agents: stringArrayField(msg, 'agents'),
    skills: stringArrayField(msg, 'skills'),
    plugins: pluginsField(msg),
  };
}

function mapSystemStatus(msg: Record<string, unknown>, sessionId: string): NeigeEvent[] {
  // SDK status payload: { type: 'system', subtype: 'status', status: 'compacting'|'requesting'|null, ... }
  // map.rs flattens to a string; null becomes empty string so the
  // wire shape stays uniform.
  const status = msg['status'];
  const value = typeof status === 'string' ? status : status === null || status === undefined ? '' : String(status);
  return [{ type: 'status_change', session_id: sessionId, status: value }];
}

function systemHookPassthrough(
  msg: Record<string, unknown>,
  sessionId: string,
  phase: 'started' | 'response' | 'progress',
): NeigeEvent {
  const hookEvent = stringField(msg, 'hook_event');
  const kind =
    hookEvent && hookEvent.length > 0
      ? `hook.${pascalToSnake(hookEvent)}.${phase}`
      : `hook.${phase}`;
  return { type: 'passthrough', session_id: sessionId, kind, payload: msg };
}

// ---- stream_event (partial assistant deltas) -------------------------------

interface StreamInner {
  type?: string;
  index?: number;
  message?: Record<string, unknown>;
  content_block?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  usage?: unknown;
}

function mapStreamEvent(msg: Record<string, unknown>, sessionId: string): NeigeEvent[] {
  const event = msg['event'];
  if (!isObject(event)) {
    return [{ type: 'passthrough', session_id: sessionId, kind: 'stream_event.unknown', payload: msg }];
  }
  const inner = event as StreamInner;
  const innerType = inner.type;
  switch (innerType) {
    case 'message_start': {
      const message = inner.message ?? {};
      return [
        {
          type: 'assistant_message_start',
          session_id: sessionId,
          message_id: stringField(message, 'id') ?? '',
          model: stringField(message, 'model') ?? '',
          parent_tool_use_id: stringField(msg, 'parent_tool_use_id') ?? null,
        },
      ];
    }
    case 'content_block_start': {
      const block = parseContentBlock(inner.content_block ?? {});
      return [
        {
          type: 'assistant_content_block_start',
          session_id: sessionId,
          message_id: '',
          index: typeof inner.index === 'number' ? inner.index : 0,
          block,
        },
      ];
    }
    case 'content_block_delta': {
      const delta = inner.delta ?? {};
      const deltaType = stringField(delta, 'type');
      const index = typeof inner.index === 'number' ? inner.index : 0;
      switch (deltaType) {
        case 'text_delta':
          return [
            {
              type: 'assistant_text_delta',
              session_id: sessionId,
              message_id: '',
              index,
              text: stringField(delta, 'text') ?? '',
            },
          ];
        case 'thinking_delta':
          return [
            {
              type: 'assistant_thinking_delta',
              session_id: sessionId,
              message_id: '',
              index,
              text: stringField(delta, 'thinking') ?? '',
            },
          ];
        case 'input_json_delta':
          return [
            {
              type: 'assistant_tool_use_input_delta',
              session_id: sessionId,
              message_id: '',
              index,
              partial_json: stringField(delta, 'partial_json') ?? '',
            },
          ];
        case 'signature_delta':
          // map.rs deliberately drops these (per-character noise that
          // only matters for replay verification). Match that.
          return [];
        default:
          // Unknown inner delta — drop, same as map.rs ContentBlockDelta::Other.
          return [];
      }
    }
    case 'content_block_stop':
      return [
        {
          type: 'assistant_content_block_stop',
          session_id: sessionId,
          message_id: '',
          index: typeof inner.index === 'number' ? inner.index : 0,
        },
      ];
    case 'message_delta': {
      const delta = inner.delta ?? {};
      return [
        {
          type: 'assistant_message_delta',
          session_id: sessionId,
          message_id: '',
          stop_reason: stringField(delta, 'stop_reason') ?? null,
          usage: inner.usage ?? null,
        },
      ];
    }
    case 'message_stop':
      return [{ type: 'assistant_message_stop', session_id: sessionId, message_id: '' }];
    default:
      return [
        {
          type: 'passthrough',
          session_id: sessionId,
          kind: `stream_event.${innerType ?? 'unknown'}`,
          payload: msg,
        },
      ];
  }
}

// ---- assistant (full-message checkpoint) ----------------------------------

function mapAssistantCheckpoint(msg: Record<string, unknown>, sessionId: string): NeigeEvent[] {
  return [{ type: 'assistant_checkpoint', session_id: sessionId, message: msg['message'] ?? null }];
}

// ---- user (real user OR synthesized tool_result wrapper) ------------------

function mapUser(msg: Record<string, unknown>, sessionId: string): NeigeEvent[] {
  const message = msg['message'];
  if (!isObject(message)) {
    return [{ type: 'passthrough', session_id: sessionId, kind: 'user', payload: msg }];
  }
  const content = (message as Record<string, unknown>)['content'];

  // SDK puts `parent_tool_use_id` on the SDKUserMessage envelope (the same
  // level as `message`). When the SDK synthesizes a user turn for a
  // sub-agent — either the spawn-time prompt or the bundled tool_result
  // wrapper — this field links the events back to the parent Task. Carry
  // it through verbatim so derive.ts can bucket sub-agent events.
  const parentToolUseId = stringField(msg, 'parent_tool_use_id') ?? null;

  // String content → real user text message.
  if (typeof content === 'string') {
    return [
      {
        type: 'user_message',
        session_id: sessionId,
        content: [{ type: 'text', text: content }],
        parent_tool_use_id: parentToolUseId,
      },
    ];
  }

  if (!Array.isArray(content)) {
    // Older / malformed shape — keep visibility via passthrough.
    return [{ type: 'passthrough', session_id: sessionId, kind: 'user', payload: msg }];
  }

  // Block-form content. Following map.rs heuristic: if any block is a
  // tool_result, treat the whole message as a synthesized tool-result
  // wrapper and emit one ToolResult event per block (dropping non-
  // tool_result blocks). Otherwise emit a single UserMessage with all
  // parsed blocks.
  const hasToolResult = content.some(
    (b) => isObject(b) && (b as Record<string, unknown>)['type'] === 'tool_result',
  );
  if (hasToolResult) {
    const out: NeigeEvent[] = [];
    for (const raw of content) {
      const parsed = parseContentBlock(isObject(raw) ? raw : {});
      if (parsed.type === 'tool_result') {
        out.push({
          type: 'tool_result',
          session_id: sessionId,
          tool_use_id: parsed.tool_use_id,
          content: parsed.content,
          is_error: parsed.is_error,
          parent_tool_use_id: parentToolUseId,
        });
      }
    }
    return out;
  }

  const blocks = content.map((b) => parseContentBlock(isObject(b) ? b : {}));
  return [
    {
      type: 'user_message',
      session_id: sessionId,
      content: blocks,
      parent_tool_use_id: parentToolUseId,
    },
  ];
}

// ---- result ---------------------------------------------------------------

function mapResult(msg: Record<string, unknown>, sessionId: string): NeigeEvent[] {
  const denials = msg['permission_denials'];
  return [
    {
      type: 'result',
      session_id: sessionId,
      subtype: stringField(msg, 'subtype') ?? '',
      is_error: msg['is_error'] === true,
      duration_ms: numberField(msg, 'duration_ms') ?? 0,
      total_cost_usd: numberField(msg, 'total_cost_usd') ?? 0,
      terminal_reason: stringField(msg, 'terminal_reason') ?? '',
      permission_denials: Array.isArray(denials) ? denials : [],
    },
  ];
}

// ---- rate_limit -----------------------------------------------------------

function mapRateLimit(msg: Record<string, unknown>, sessionId: string): NeigeEvent[] {
  const info = msg['rate_limit_info'] ?? null;
  return [{ type: 'rate_limit', session_id: sessionId, info }];
}

// ---- helpers --------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(obj: unknown, key: string): string | undefined {
  if (!isObject(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function numberField(obj: unknown, key: string): number | undefined {
  if (!isObject(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function stringArrayField(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function mcpServersField(obj: Record<string, unknown>): { name: string; status: string }[] {
  const v = obj['mcp_servers'];
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObject)
    .map((s) => ({
      name: stringField(s, 'name') ?? '',
      status: stringField(s, 'status') ?? '',
    }));
}

function pluginsField(obj: Record<string, unknown>): { name: string; source: string | null }[] {
  const v = obj['plugins'];
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObject)
    .map((p) => ({
      name: stringField(p, 'name') ?? '',
      // SDK uses `path`; the existing Rust shape calls it `source`. Map
      // path → source so the wire stays stable for the frontend. If a
      // future SDK message carries an explicit `source` field, prefer it.
      source: stringField(p, 'source') ?? stringField(p, 'path') ?? null,
    }));
}

/**
 * Convert a raw content-block object to our typed `ContentBlock` union.
 * Falls back to `unknown` so callers never lose data.
 */
export function parseContentBlock(raw: Record<string, unknown>): ContentBlock {
  const ty = stringField(raw, 'type') ?? '';
  switch (ty) {
    case 'text':
      return { type: 'text', text: stringField(raw, 'text') ?? '' };
    case 'thinking':
      return { type: 'thinking', thinking: stringField(raw, 'thinking') ?? '' };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: stringField(raw, 'id') ?? '',
        name: stringField(raw, 'name') ?? '',
        input: raw['input'] ?? {},
      };
    case 'tool_result': {
      const rawContent = raw['content'];
      let content: ToolResultContent;
      if (typeof rawContent === 'string') {
        content = rawContent;
      } else if (Array.isArray(rawContent)) {
        content = rawContent.map((b) => parseContentBlock(isObject(b) ? b : {}));
      } else if (rawContent === undefined || rawContent === null) {
        content = '';
      } else {
        // Non-string / non-array — stringify so the frontend gets
        // something renderable. Matches the `Value::to_string()`
        // fallback in map.rs.
        content = JSON.stringify(rawContent);
      }
      return {
        type: 'tool_result',
        tool_use_id: stringField(raw, 'tool_use_id') ?? '',
        content,
        is_error: raw['is_error'] === true,
      };
    }
    case 'image':
      return { type: 'image', source: raw['source'] ?? {} };
    default:
      return { type: 'unknown', type_name: ty, value: raw };
  }
}

/**
 * `PreToolUse` → `pre_tool_use`. Used to build the
 * `hook.<event>.<phase>` discriminator for system hook passthroughs.
 *
 * Mirrors `pascal_to_snake` in map.rs so the frontend sees one stable
 * canonical form regardless of capitalization drift in the SDK.
 */
export function pascalToSnake(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch >= 'A' && ch <= 'Z') {
      if (i !== 0) out += '_';
      out += ch.toLowerCase();
    } else {
      out += ch;
    }
  }
  return out;
}
