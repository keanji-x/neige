import { describe, expect, it, vi } from 'vitest';

import {
  ALL_KNOWN_SDK_MESSAGE_KEYS,
  mapSdkMessage,
  messageKey,
  parseContentBlock,
  pascalToSnake,
} from '../src/mapper.js';
import type { NeigeEvent } from '../src/types.js';

const SID = '11111111-1111-1111-1111-111111111111';

/** Round-trip a single event through JSON to assert it's pure data. */
function jsonRoundtrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('pascalToSnake', () => {
  it('converts hook event names', () => {
    expect(pascalToSnake('PreToolUse')).toBe('pre_tool_use');
    expect(pascalToSnake('PostToolUse')).toBe('post_tool_use');
    expect(pascalToSnake('UserPromptSubmit')).toBe('user_prompt_submit');
    expect(pascalToSnake('Stop')).toBe('stop');
  });

  it('passes already-snake input through', () => {
    expect(pascalToSnake('already_snake')).toBe('already_snake');
  });
});

describe('parseContentBlock', () => {
  it('parses text', () => {
    expect(parseContentBlock({ type: 'text', text: 'hi' })).toEqual({
      type: 'text',
      text: 'hi',
    });
  });

  it('parses thinking', () => {
    expect(parseContentBlock({ type: 'thinking', thinking: 'hmm' })).toEqual({
      type: 'thinking',
      thinking: 'hmm',
    });
  });

  it('parses tool_use', () => {
    expect(
      parseContentBlock({ type: 'tool_use', id: 'tu1', name: 'Bash', input: { cmd: 'ls' } }),
    ).toEqual({ type: 'tool_use', id: 'tu1', name: 'Bash', input: { cmd: 'ls' } });
  });

  it('parses tool_result with string content', () => {
    expect(
      parseContentBlock({
        type: 'tool_result',
        tool_use_id: 'tu1',
        content: 'ok',
        is_error: false,
      }),
    ).toEqual({ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false });
  });

  it('parses tool_result with array content (recursive)', () => {
    const block = parseContentBlock({
      type: 'tool_result',
      tool_use_id: 'tu1',
      content: [
        { type: 'text', text: 'part 1' },
        { type: 'image', source: { type: 'base64', data: 'AAA' } },
      ],
      is_error: true,
    });
    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu1',
      content: [
        { type: 'text', text: 'part 1' },
        { type: 'image', source: { type: 'base64', data: 'AAA' } },
      ],
      is_error: true,
    });
  });

  it('falls back to unknown for unrecognized block types', () => {
    const block = parseContentBlock({ type: 'future_block', x: 1 });
    expect(block).toEqual({
      type: 'unknown',
      type_name: 'future_block',
      value: { type: 'future_block', x: 1 },
    });
  });
});

describe('mapSdkMessage — system', () => {
  it('maps init to session_init with all fields', () => {
    const msg = {
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-4-7',
      permissionMode: 'default',
      cwd: '/tmp',
      claude_code_version: '0.0.99',
      tools: ['Read', 'Bash'],
      mcp_servers: [{ name: 'fs', status: 'connected' }],
      slash_commands: ['/help'],
      agents: ['planner'],
      skills: ['init'],
      plugins: [{ name: 'p', path: '/p' }],
    };
    const out = mapSdkMessage(msg, SID);
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'session_init',
        session_id: SID,
        model: 'claude-opus-4-7',
        permission_mode: 'default',
        cwd: '/tmp',
        version: '0.0.99',
        tools: ['Read', 'Bash'],
        mcp_servers: [{ name: 'fs', status: 'connected' }],
        slash_commands: ['/help'],
        agents: ['planner'],
        skills: ['init'],
        plugins: [{ name: 'p', source: '/p' }],
      },
    ]);
    expect(jsonRoundtrip(out)).toEqual(out);
  });

  it('maps status to status_change', () => {
    expect(mapSdkMessage({ type: 'system', subtype: 'status', status: 'requesting' }, SID)).toEqual<
      NeigeEvent[]
    >([{ type: 'status_change', session_id: SID, status: 'requesting' }]);
  });

  it('maps null status to empty string', () => {
    expect(mapSdkMessage({ type: 'system', subtype: 'status', status: null }, SID)).toEqual<
      NeigeEvent[]
    >([{ type: 'status_change', session_id: SID, status: '' }]);
  });

  it('maps hook_started to passthrough hook.<event>.started', () => {
    const out = mapSdkMessage(
      {
        type: 'system',
        subtype: 'hook_started',
        hook_id: 'h1',
        hook_event: 'PreToolUse',
        hook_name: 'PreToolUse:Bash',
      },
      SID,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'passthrough',
      session_id: SID,
      kind: 'hook.pre_tool_use.started',
    });
  });

  it('maps hook_response to passthrough hook.<event>.response', () => {
    const out = mapSdkMessage(
      {
        type: 'system',
        subtype: 'hook_response',
        hook_id: 'h2',
        hook_event: 'PostToolUse',
        hook_name: 'PostToolUse:Bash',
        outcome: 'success',
      },
      SID,
    );
    expect(out[0]).toMatchObject({ kind: 'hook.post_tool_use.response' });
  });

  it('maps hook event without hook_event to bare hook.<phase>', () => {
    const out = mapSdkMessage({ type: 'system', subtype: 'hook_started' }, SID);
    expect(out[0]).toMatchObject({ kind: 'hook.started' });
  });

  it('maps unknown system subtype to system.<subtype> passthrough', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = mapSdkMessage({ type: 'system', subtype: 'brand_new' }, SID);
    expect(out[0]).toMatchObject({ kind: 'system.brand_new' });
    stderr.mockRestore();
  });
});

describe('mapSdkMessage — stream_event', () => {
  it('maps message_start with parent_tool_use_id', () => {
    const out = mapSdkMessage(
      {
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-4-7' } },
        parent_tool_use_id: 'tu_outer',
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'assistant_message_start',
        session_id: SID,
        message_id: 'msg_1',
        model: 'claude-opus-4-7',
        parent_tool_use_id: 'tu_outer',
      },
    ]);
  });

  it('maps text_delta', () => {
    const out = mapSdkMessage(
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'hi' } },
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      { type: 'assistant_text_delta', session_id: SID, message_id: '', index: 2, text: 'hi' },
    ]);
  });

  it('maps thinking_delta', () => {
    const out = mapSdkMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'pondering' },
        },
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'assistant_thinking_delta',
        session_id: SID,
        message_id: '',
        index: 0,
        text: 'pondering',
      },
    ]);
  });

  it('maps input_json_delta', () => {
    const out = mapSdkMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"x":' },
        },
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'assistant_tool_use_input_delta',
        session_id: SID,
        message_id: '',
        index: 1,
        partial_json: '{"x":',
      },
    ]);
  });

  it('drops signature_delta silently (matches Rust map.rs)', () => {
    const out = mapSdkMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'sig' },
        },
      },
      SID,
    );
    expect(out).toEqual([]);
  });

  it('maps content_block_start with tool_use', () => {
    const out = mapSdkMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} },
        },
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'assistant_content_block_start',
        session_id: SID,
        message_id: '',
        index: 0,
        block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} },
      },
    ]);
  });

  it('maps content_block_stop and message_stop', () => {
    const stop = mapSdkMessage(
      { type: 'stream_event', event: { type: 'content_block_stop', index: 3 } },
      SID,
    );
    expect(stop).toEqual<NeigeEvent[]>([
      { type: 'assistant_content_block_stop', session_id: SID, message_id: '', index: 3 },
    ]);
    const msgStop = mapSdkMessage(
      { type: 'stream_event', event: { type: 'message_stop' } },
      SID,
    );
    expect(msgStop).toEqual<NeigeEvent[]>([
      { type: 'assistant_message_stop', session_id: SID, message_id: '' },
    ]);
  });

  it('maps message_delta with stop_reason and usage', () => {
    const out = mapSdkMessage(
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'assistant_message_delta',
        session_id: SID,
        message_id: '',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    ]);
  });

  it('maps unknown inner stream event to stream_event.<type> passthrough', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = mapSdkMessage(
      { type: 'stream_event', event: { type: 'future_inner', data: 1 } },
      SID,
    );
    expect(out[0]).toMatchObject({ type: 'passthrough', kind: 'stream_event.future_inner' });
    stderr.mockRestore();
  });
});

describe('mapSdkMessage — user / tool_result', () => {
  it('maps a real user text message', () => {
    const out = mapSdkMessage(
      { type: 'user', message: { role: 'user', content: 'hello' } },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'user_message',
        session_id: SID,
        content: [{ type: 'text', text: 'hello' }],
        parent_tool_use_id: null,
      },
    ]);
  });

  it('maps a synthesized user tool_result wrapper to ToolResult events', () => {
    const out = mapSdkMessage(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false },
            { type: 'tool_result', tool_use_id: 'tu2', content: 'err', is_error: true },
          ],
        },
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'tool_result',
        session_id: SID,
        tool_use_id: 'tu1',
        content: 'ok',
        is_error: false,
        parent_tool_use_id: null,
      },
      {
        type: 'tool_result',
        session_id: SID,
        tool_use_id: 'tu2',
        content: 'err',
        is_error: true,
        parent_tool_use_id: null,
      },
    ]);
  });

  it('maps a structured user message (no tool_result blocks) to user_message', () => {
    const out = mapSdkMessage(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'before' },
            { type: 'image', source: { type: 'base64', data: 'AAA' } },
          ],
        },
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'user_message',
        session_id: SID,
        content: [
          { type: 'text', text: 'before' },
          { type: 'image', source: { type: 'base64', data: 'AAA' } },
        ],
        parent_tool_use_id: null,
      },
    ]);
  });
});

describe('mapSdkMessage — assistant checkpoint, result, rate_limit', () => {
  it('maps full assistant message to assistant_checkpoint', () => {
    const message = {
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
    };
    const out = mapSdkMessage({ type: 'assistant', message, parent_tool_use_id: null }, SID);
    expect(out).toEqual<NeigeEvent[]>([
      { type: 'assistant_checkpoint', session_id: SID, message },
    ]);
  });

  it('maps result.success', () => {
    const out = mapSdkMessage(
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1234,
        total_cost_usd: 0.05,
        terminal_reason: 'completed',
        permission_denials: [],
      },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'result',
        session_id: SID,
        subtype: 'success',
        is_error: false,
        duration_ms: 1234,
        total_cost_usd: 0.05,
        terminal_reason: 'completed',
        permission_denials: [],
      },
    ]);
  });

  it('maps rate_limit_event', () => {
    const info = { status: 'allowed_warning', utilization: 0.9 };
    const out = mapSdkMessage(
      { type: 'rate_limit_event', rate_limit_info: info },
      SID,
    );
    expect(out).toEqual<NeigeEvent[]>([{ type: 'rate_limit', session_id: SID, info }]);
  });
});

describe('mapSdkMessage — fallthrough', () => {
  it('routes unknown top-level type to passthrough with original type', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = mapSdkMessage({ type: 'future_thing', x: 1 }, SID);
    expect(out).toEqual<NeigeEvent[]>([
      {
        type: 'passthrough',
        session_id: SID,
        kind: 'future_thing',
        payload: { type: 'future_thing', x: 1 },
      },
    ]);
    stderr.mockRestore();
  });

  it('falls back to kind=unknown when type is missing', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = mapSdkMessage({ x: 1 }, SID);
    expect(out[0]).toMatchObject({ kind: 'unknown' });
    stderr.mockRestore();
  });

  it('drops non-objects', () => {
    expect(mapSdkMessage(null, SID)).toEqual([]);
    expect(mapSdkMessage('not an object', SID)).toEqual([]);
    expect(mapSdkMessage(42, SID)).toEqual([]);
  });
});

describe('messageKey', () => {
  it('returns top-level type for non-system, non-stream messages', () => {
    expect(messageKey({ type: 'assistant', message: {} })).toBe('assistant');
    expect(messageKey({ type: 'user', message: { role: 'user', content: 'hi' } })).toBe('user');
    expect(messageKey({ type: 'result', subtype: 'success' })).toBe('result');
    expect(messageKey({ type: 'rate_limit_event', rate_limit_info: null })).toBe('rate_limit_event');
  });

  it('returns system:<subtype> for system messages', () => {
    expect(messageKey({ type: 'system', subtype: 'init' })).toBe('system:init');
    expect(messageKey({ type: 'system', subtype: 'status', status: 'requesting' })).toBe(
      'system:status',
    );
    expect(messageKey({ type: 'system', subtype: 'brand_new' })).toBe('system:brand_new');
    expect(messageKey({ type: 'system' })).toBe('system');
  });

  it('returns stream_event:<inner> and stream_event:content_block_delta:<delta>', () => {
    expect(messageKey({ type: 'stream_event', event: { type: 'message_stop' } })).toBe(
      'stream_event:message_stop',
    );
    expect(
      messageKey({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } },
      }),
    ).toBe('stream_event:content_block_delta:text_delta');
    expect(messageKey({ type: 'stream_event' })).toBe('stream_event');
  });

  it('returns empty string for non-objects and missing type', () => {
    expect(messageKey(null)).toBe('');
    expect(messageKey({})).toBe('');
    expect(messageKey({ x: 1 })).toBe('');
  });
});

describe('warnUnknown via mapSdkMessage stderr', () => {
  it('writes a stderr warning for unknown top-level keys', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = mapSdkMessage({ type: 'future_thing', x: 1 }, SID);
    expect(out[0]).toMatchObject({ type: 'passthrough', kind: 'future_thing' });
    expect(stderr).toHaveBeenCalledTimes(1);
    const arg = String(stderr.mock.calls[0]![0]);
    expect(arg).toContain('[neige-chat-runner] unknown SDK message key:');
    expect(arg).toContain('future_thing');
    expect(arg.endsWith('\n')).toBe(true);
    stderr.mockRestore();
  });

  it('writes a stderr warning for unknown system subtypes and stream inner types', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mapSdkMessage({ type: 'system', subtype: 'brand_new' }, SID);
    mapSdkMessage({ type: 'stream_event', event: { type: 'future_inner' } }, SID);
    mapSdkMessage(
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'future_delta' } },
      },
      SID,
    );
    expect(stderr).toHaveBeenCalledTimes(3);
    const lines = stderr.mock.calls.map((c) => String(c[0]));
    expect(lines[0]).toContain('system:brand_new');
    expect(lines[1]).toContain('stream_event:future_inner');
    expect(lines[2]).toContain('stream_event:content_block_delta:future_delta');
    stderr.mockRestore();
  });

  it('does NOT warn for known SDK message keys', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // A representative spread of known leaf keys — every one of these
    // is in ALL_KNOWN_SDK_MESSAGE_KEYS, so warn must stay silent even
    // though e.g. signature_delta drops to [] and rate_limit_event has
    // no dedicated test case in this file's other blocks.
    mapSdkMessage({ type: 'system', subtype: 'init' }, SID);
    mapSdkMessage({ type: 'system', subtype: 'status', status: 'requesting' }, SID);
    mapSdkMessage({ type: 'system', subtype: 'hook_progress', hook_event: 'PreToolUse' }, SID);
    mapSdkMessage({ type: 'assistant', message: {} }, SID);
    mapSdkMessage({ type: 'user', message: { role: 'user', content: 'hi' } }, SID);
    mapSdkMessage(
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 0, total_cost_usd: 0 },
      SID,
    );
    mapSdkMessage({ type: 'rate_limit_event', rate_limit_info: null }, SID);
    mapSdkMessage(
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 's' } },
      },
      SID,
    );
    mapSdkMessage({ type: 'stream_event', event: { type: 'message_stop' } }, SID);
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('truncates the stderr preview for very large messages', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const big = { type: 'future_thing', blob: 'x'.repeat(5000) };
    mapSdkMessage(big, SID);
    const arg = String(stderr.mock.calls[0]![0]);
    expect(arg).toContain('...');
    // Header (label + colon + spaces + key) + truncated preview (200 chars + '...') + newline.
    // Allow generous slack but assert it's not the full 5kB.
    expect(arg.length).toBeLessThan(400);
    stderr.mockRestore();
  });
});

describe('ALL_KNOWN_SDK_MESSAGE_KEYS', () => {
  it('contains every key the mapper currently dispatches on', () => {
    const expected = [
      'assistant',
      'user',
      'result',
      'stream_event',
      'rate_limit_event',
      'system',
      'system:init',
      'system:status',
      'system:hook_started',
      'system:hook_response',
      'system:hook_progress',
      'stream_event:message_start',
      'stream_event:content_block_start',
      'stream_event:content_block_delta',
      'stream_event:content_block_stop',
      'stream_event:message_delta',
      'stream_event:message_stop',
      'stream_event:content_block_delta:text_delta',
      'stream_event:content_block_delta:thinking_delta',
      'stream_event:content_block_delta:input_json_delta',
      'stream_event:content_block_delta:signature_delta',
    ];
    for (const k of expected) {
      expect(ALL_KNOWN_SDK_MESSAGE_KEYS.has(k)).toBe(true);
    }
    expect(ALL_KNOWN_SDK_MESSAGE_KEYS.size).toBe(expected.length);
  });
});

describe('NeigeEvent JSON round-trip', () => {
  it('every emitted event is plain JSON-safe', () => {
    const cases: unknown[] = [
      { type: 'system', subtype: 'init', model: 'm', permissionMode: 'd', cwd: '/', claude_code_version: '1', tools: [], mcp_servers: [], slash_commands: [], agents: [], skills: [], plugins: [] },
      { type: 'system', subtype: 'status', status: 'requesting' },
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm', model: 'x' } }, parent_tool_use_id: null },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } } },
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, total_cost_usd: 0, terminal_reason: 'completed', permission_denials: [] },
    ];
    for (const c of cases) {
      const events = mapSdkMessage(c, SID);
      const cycled = JSON.parse(JSON.stringify(events));
      expect(cycled).toEqual(events);
    }
  });
});
