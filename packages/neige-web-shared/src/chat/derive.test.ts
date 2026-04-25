// Vitest tests for the timeline reducer. The shared package does not yet have
// a test runner wired up; these run once `vitest` is installed and a config
// (or `npm test` script) exists. Keep the assertions framework-agnostic
// (no jest-dom matchers) so wiring is purely runner setup.

import { describe, it, expect } from 'vitest';
import { deriveTimeline } from './derive';
import type { NeigeEvent } from './types';

describe('deriveTimeline', () => {
  it('captures session_init', () => {
    const events: NeigeEvent[] = [
      {
        type: 'session_init',
        session_id: 's1',
        model: 'claude-3.7',
        permission_mode: 'default',
        cwd: '/tmp',
        version: '1.0',
        tools: ['Read'],
        mcp_servers: [],
        slash_commands: [],
        agents: [],
        skills: [],
        plugins: [],
      },
    ];
    const { timeline } = deriveTimeline(events);
    expect(timeline.init?.sessionId).toBe('s1');
    expect(timeline.init?.tools).toEqual(['Read']);
  });

  it('appends streamed text deltas', () => {
    const events: NeigeEvent[] = [
      {
        type: 'assistant_message_start',
        session_id: 's1',
        message_id: 'm1',
        model: 'claude',
        parent_tool_use_id: null,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's1',
        message_id: 'm1',
        index: 0,
        block: { type: 'text', text: '' },
      },
      {
        type: 'assistant_text_delta',
        session_id: 's1',
        message_id: 'm1',
        index: 0,
        text: 'Hello ',
      },
      {
        type: 'assistant_text_delta',
        session_id: 's1',
        message_id: 'm1',
        index: 0,
        text: 'world',
      },
      {
        type: 'assistant_content_block_stop',
        session_id: 's1',
        message_id: 'm1',
        index: 0,
      },
      { type: 'assistant_message_stop', session_id: 's1', message_id: 'm1' },
    ];
    const { timeline } = deriveTimeline(events);
    const msg = timeline.messages[0];
    expect(msg.role).toBe('assistant');
    if (msg.role !== 'assistant') return;
    expect(msg.isComplete).toBe(true);
    const block = msg.blocks[0];
    expect(block.type).toBe('text');
    if (block.type === 'text') {
      expect(block.text).toBe('Hello world');
      expect(block.isStreaming).toBe(false);
    }
  });

  it('reconstructs tool_use input from partial JSON deltas', () => {
    const events: NeigeEvent[] = [
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'm',
        model: 'c',
        parent_tool_use_id: null,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: 'm',
        index: 0,
        block: { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      },
      {
        type: 'assistant_tool_use_input_delta',
        session_id: 's',
        message_id: 'm',
        index: 0,
        partial_json: '{"file_path":',
      },
      {
        type: 'assistant_tool_use_input_delta',
        session_id: 's',
        message_id: 'm',
        index: 0,
        partial_json: '"/tmp/x.ts"}',
      },
      {
        type: 'assistant_content_block_stop',
        session_id: 's',
        message_id: 'm',
        index: 0,
      },
    ];
    const { timeline } = deriveTimeline(events);
    const msg = timeline.messages[0];
    if (msg.role !== 'assistant') throw new Error('expected assistant');
    const block = msg.blocks[0];
    if (block.type !== 'tool_use') throw new Error('expected tool_use');
    expect(block.input).toEqual({ file_path: '/tmp/x.ts' });
  });

  it('matches tool_result by tool_use_id', () => {
    const events: NeigeEvent[] = [
      {
        type: 'tool_result',
        session_id: 's',
        tool_use_id: 't1',
        content: 'ok',
        is_error: false,
      },
    ];
    const { toolResults } = deriveTimeline(events);
    expect(toolResults['t1'].content).toEqual('ok');
    expect(toolResults['t1'].isError).toBe(false);
  });

  it('drops orphan deltas without throwing', () => {
    const events: NeigeEvent[] = [
      {
        type: 'assistant_text_delta',
        session_id: 's',
        message_id: 'missing',
        index: 0,
        text: 'oops',
      },
    ];
    expect(() => deriveTimeline(events)).not.toThrow();
  });

  it('streams text when delta events have empty message_id (real backend shape)', () => {
    // The Rust mapper only attaches message_id on `assistant_message_start`;
    // deltas/stops/etc. arrive with message_id="" and the reducer must fall
    // back to the most recent assistant message.
    const events: NeigeEvent[] = [
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'msg_real_id',
        model: 'claude',
        parent_tool_use_id: null,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: { type: 'text', text: '' },
      },
      { type: 'assistant_text_delta', session_id: 's', message_id: '', index: 0, text: 'hel' },
      { type: 'assistant_text_delta', session_id: 's', message_id: '', index: 0, text: 'lo' },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
    ];
    const { timeline } = deriveTimeline(events);
    expect(timeline.messages).toHaveLength(1);
    const msg = timeline.messages[0];
    if (msg.role !== 'assistant') throw new Error('expected assistant');
    expect(msg.isComplete).toBe(true);
    expect(msg.blocks).toHaveLength(1);
    const block = msg.blocks[0];
    if (block.type !== 'text') throw new Error('expected text');
    expect(block.text).toBe('hello');
    expect(block.isStreaming).toBe(false);
  });

  it('renders a user_message event as a user-role bubble', () => {
    // Locks the optimistic user-bubble path: useChatSession.sendMessage
    // appends a synthetic user_message NeigeEvent so the bubble appears
    // instantly without round-tripping through claude.
    const events: NeigeEvent[] = [
      {
        type: 'user_message',
        session_id: '',
        content: [{ type: 'text', text: 'hello claude' }],
      },
    ];
    const { timeline } = deriveTimeline(events);
    expect(timeline.messages).toHaveLength(1);
    const msg = timeline.messages[0];
    expect(msg.role).toBe('user');
    if (msg.role !== 'user') throw new Error('expected user');
    expect(msg.blocks).toEqual([{ type: 'text', text: 'hello claude' }]);
  });

  it('handles full optimistic user → assistant streamed reply flow', () => {
    // End-to-end shape sanity for the most common turn: user sends, claude
    // streams a reply with thinking + text + tool_use + tool_result.
    const events: NeigeEvent[] = [
      {
        type: 'user_message',
        session_id: '',
        content: [{ type: 'text', text: 'read /etc/hostname' }],
      },
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'm1',
        model: 'claude',
        parent_tool_use_id: null,
      },
      // Thinking
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: { type: 'thinking', thinking: '' },
      },
      { type: 'assistant_thinking_delta', session_id: 's', message_id: '', index: 0, text: 'reasoning…' },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      // Tool use (Read)
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 1,
        block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
      },
      {
        type: 'assistant_tool_use_input_delta',
        session_id: 's',
        message_id: '',
        index: 1,
        partial_json: '{"file_path":"/etc/hostname"}',
      },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 1 },
      // Tool result (synthesized as a user-side tool_result wrapper)
      {
        type: 'tool_result',
        session_id: 's',
        tool_use_id: 'toolu_1',
        content: 'pivot\n',
        is_error: false,
      },
      // Final text block
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 2,
        block: { type: 'text', text: '' },
      },
      { type: 'assistant_text_delta', session_id: 's', message_id: '', index: 2, text: 'host is pivot' },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 2 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
    ];
    const { timeline, toolResults } = deriveTimeline(events);
    expect(timeline.messages).toHaveLength(2);
    expect(timeline.messages[0].role).toBe('user');
    const asst = timeline.messages[1];
    if (asst.role !== 'assistant') throw new Error('expected assistant');
    expect(asst.isComplete).toBe(true);
    expect(asst.blocks.length).toBe(3);
    expect(asst.blocks[0].type).toBe('thinking');
    expect(asst.blocks[1].type).toBe('tool_use');
    expect(asst.blocks[2].type).toBe('text');
    if (asst.blocks[1].type !== 'tool_use') throw new Error();
    expect(asst.blocks[1].input).toEqual({ file_path: '/etc/hostname' });
    if (asst.blocks[2].type !== 'text') throw new Error();
    expect(asst.blocks[2].text).toBe('host is pivot');
    expect(toolResults['toolu_1'].content).toBe('pivot\n');
    expect(toolResults['toolu_1'].isError).toBe(false);
  });

  it('routes a passthrough event into timeline.passthroughs anchored to the latest message', () => {
    const events: NeigeEvent[] = [
      {
        type: 'user_message',
        session_id: '',
        content: [{ type: 'text', text: 'hi' }],
      },
      {
        type: 'passthrough',
        session_id: 's',
        kind: 'hook.pre_tool_use',
        payload: { tool_name: 'Read', tool_input: { file_path: '/etc/hostname' } },
      },
    ];
    const { timeline } = deriveTimeline(events);
    expect(timeline.passthroughs).toHaveLength(1);
    const entry = timeline.passthroughs[0];
    expect(entry.kind).toBe('hook.pre_tool_use');
    expect(entry.payload).toEqual({
      tool_name: 'Read',
      tool_input: { file_path: '/etc/hostname' },
    });
    expect(entry.insertedAfterMessageIndex).toBe(0);
    expect(entry.id).toMatch(/^passthrough-/);
  });

  it('passthrough before any message has insertedAfterMessageIndex=null', () => {
    const events: NeigeEvent[] = [
      {
        type: 'passthrough',
        session_id: 's',
        kind: 'rate_limit_event',
        payload: { remaining: 100 },
      },
    ];
    const { timeline } = deriveTimeline(events);
    expect(timeline.passthroughs).toHaveLength(1);
    expect(timeline.passthroughs[0].insertedAfterMessageIndex).toBeNull();
  });

  it('records result event', () => {
    const events: NeigeEvent[] = [
      {
        type: 'result',
        session_id: 's',
        subtype: 'success',
        is_error: false,
        duration_ms: 1234,
        total_cost_usd: 0.0042,
        terminal_reason: 'end_turn',
        permission_denials: [],
      },
    ];
    const { timeline } = deriveTimeline(events);
    expect(timeline.result?.durationMs).toBe(1234);
    expect(timeline.result?.totalCostUsd).toBeCloseTo(0.0042);
  });
});
