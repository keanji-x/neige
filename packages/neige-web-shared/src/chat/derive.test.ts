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

  // ---- sub-agent bucketing (Task tool) -------------------------------------

  it('isolates sub-agent stream into a separate timeline keyed by Task tool_use_id', () => {
    // Parent calls Task → sub-agent emits its own assistant message with
    // parent_tool_use_id pointing at the Task block. The sub-agent's events
    // must NOT show up in the root's `messages`; they must be under
    // `subagents[<task tool_use_id>]`.
    const TASK_ID = 'toolu_task_1';
    const events: NeigeEvent[] = [
      // Root assistant calling Task.
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'parent-msg',
        model: 'claude',
        parent_tool_use_id: null,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: {
          type: 'tool_use',
          id: TASK_ID,
          name: 'Task',
          input: { description: 'find', prompt: 'p', subagent_type: 'general-purpose' },
        },
      },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
      // Sub-agent stream — note parent_tool_use_id = TASK_ID.
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'sub-msg',
        model: 'claude',
        parent_tool_use_id: TASK_ID,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: { type: 'text', text: '' },
      },
      { type: 'assistant_text_delta', session_id: 's', message_id: '', index: 0, text: 'sub said' },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
      // Final tool_result for the parent's Task call (no parent — destined for root).
      {
        type: 'tool_result',
        session_id: 's',
        tool_use_id: TASK_ID,
        content: 'sub said',
        is_error: false,
        parent_tool_use_id: null,
      },
    ];
    const { timeline, toolResults } = deriveTimeline(events);

    // Root must have exactly the parent assistant turn — no sub-agent leak.
    expect(timeline.messages).toHaveLength(1);
    const parent = timeline.messages[0];
    if (parent.role !== 'assistant') throw new Error('expected assistant');
    expect(parent.blocks).toHaveLength(1);
    const taskBlock = parent.blocks[0];
    if (taskBlock.type !== 'tool_use') throw new Error('expected tool_use');
    expect(taskBlock.toolUseId).toBe(TASK_ID);

    // Sub-agent timeline must exist under the Task tool_use_id.
    const sub = timeline.subagents[TASK_ID];
    expect(sub).toBeDefined();
    expect(sub.messages).toHaveLength(1);
    const subMsg = sub.messages[0];
    if (subMsg.role !== 'assistant') throw new Error('expected assistant');
    const subBlock = subMsg.blocks[0];
    if (subBlock.type !== 'text') throw new Error('expected text');
    expect(subBlock.text).toBe('sub said');

    // tool_result for the Task call lives in the root's tool result map,
    // since it's destined for the root's tool_use block.
    expect(toolResults[TASK_ID]?.content).toBe('sub said');
  });

  it('routes a sub-agent\'s OWN tool_result into that sub-agent\'s timeline', () => {
    // Inside a sub-agent, calls to e.g. Read produce tool_result events with
    // parent_tool_use_id = the Task that owns the sub-agent (NOT the inner
    // tool's id). Those must bucket into the sub-agent timeline so the
    // Read card inside the sub-agent renders its result.
    const TASK_ID = 'toolu_task_outer';
    const READ_ID = 'toolu_read_inner';
    const events: NeigeEvent[] = [
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'parent',
        model: 'c',
        parent_tool_use_id: null,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: {
          type: 'tool_use',
          id: TASK_ID,
          name: 'Task',
          input: { description: 'd', prompt: 'p', subagent_type: 'general-purpose' },
        },
      },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
      // Sub-agent calls Read.
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'sub',
        model: 'c',
        parent_tool_use_id: TASK_ID,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: { type: 'tool_use', id: READ_ID, name: 'Read', input: { file_path: '/a' } },
      },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
      // Inner tool_result — parent_tool_use_id is the Task owning the sub-agent.
      {
        type: 'tool_result',
        session_id: 's',
        tool_use_id: READ_ID,
        content: 'file body',
        is_error: false,
        parent_tool_use_id: TASK_ID,
      },
    ];
    const { timeline, toolResults } = deriveTimeline(events);

    // The Read tool_use must live in the sub-agent's messages, not root.
    const sub = timeline.subagents[TASK_ID];
    expect(sub).toBeDefined();
    const subMsg = sub.messages[0];
    if (subMsg.role !== 'assistant') throw new Error('expected assistant');
    expect(subMsg.blocks[0].type).toBe('tool_use');

    // Tool result lookup is flat (toolUseIds are globally unique) — both
    // root and sub-agent renderers can find their own results.
    expect(toolResults[READ_ID]?.content).toBe('file body');
  });

  it('builds a recursive timeline tree for nested Task calls', () => {
    // Task A spawns sub-agent A; sub-agent A calls Task B which spawns
    // sub-agent B. After derive, root.subagents[A].subagents[B] holds B's
    // stream — no flattening, no orphans.
    const TASK_A = 'toolu_task_a';
    const TASK_B = 'toolu_task_b';
    const events: NeigeEvent[] = [
      // Root → Task A
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'root-msg',
        model: 'c',
        parent_tool_use_id: null,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: {
          type: 'tool_use',
          id: TASK_A,
          name: 'Task',
          input: { description: 'a', prompt: 'p', subagent_type: 'general-purpose' },
        },
      },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
      // Sub-agent A → Task B
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'a-msg',
        model: 'c',
        parent_tool_use_id: TASK_A,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: {
          type: 'tool_use',
          id: TASK_B,
          name: 'Task',
          input: { description: 'b', prompt: 'p', subagent_type: 'general-purpose' },
        },
      },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
      // Sub-agent B
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'b-msg',
        model: 'c',
        parent_tool_use_id: TASK_B,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: { type: 'text', text: '' },
      },
      { type: 'assistant_text_delta', session_id: 's', message_id: '', index: 0, text: 'leaf' },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
    ];
    const { timeline } = deriveTimeline(events);

    // root.subagents has A but not B.
    expect(Object.keys(timeline.subagents)).toEqual([TASK_A]);
    const subA = timeline.subagents[TASK_A];
    // A.subagents has B (nested), not at root.
    expect(Object.keys(subA.subagents)).toEqual([TASK_B]);
    const subB = subA.subagents[TASK_B];
    // B contains the leaf text.
    expect(subB.messages).toHaveLength(1);
    const leafMsg = subB.messages[0];
    if (leafMsg.role !== 'assistant') throw new Error('expected assistant');
    const leafBlock = leafMsg.blocks[0];
    if (leafBlock.type !== 'text') throw new Error('expected text');
    expect(leafBlock.text).toBe('leaf');
  });

  it('attaches an orphan sub-agent (host tool_use missing) to root rather than dropping it', () => {
    // Truncated event window: the parent assistant_message_start (and its
    // Task block) was dropped, but sub-agent events are still present. We
    // still want to surface the sub-agent rather than silently lose its
    // content — attach to root as a fallback.
    const TASK_ID = 'toolu_orphaned';
    const events: NeigeEvent[] = [
      {
        type: 'assistant_message_start',
        session_id: 's',
        message_id: 'sub-msg',
        model: 'c',
        parent_tool_use_id: TASK_ID,
      },
      {
        type: 'assistant_content_block_start',
        session_id: 's',
        message_id: '',
        index: 0,
        block: { type: 'text', text: '' },
      },
      { type: 'assistant_text_delta', session_id: 's', message_id: '', index: 0, text: 'orphan' },
      { type: 'assistant_content_block_stop', session_id: 's', message_id: '', index: 0 },
      { type: 'assistant_message_stop', session_id: 's', message_id: '' },
    ];
    const { timeline } = deriveTimeline(events);
    expect(timeline.subagents[TASK_ID]).toBeDefined();
    expect(timeline.subagents[TASK_ID].messages).toHaveLength(1);
  });

  it('treats an undefined parent_tool_use_id as root (wire backward compat)', () => {
    // tool_result emitted by a runner that pre-dates the field carries no
    // parent_tool_use_id at all. Must default to the root bucket so old
    // sessions keep rendering correctly after this refactor.
    const events: NeigeEvent[] = [
      {
        type: 'tool_result',
        session_id: 's',
        tool_use_id: 'toolu_legacy',
        content: 'ok',
        is_error: false,
        // parent_tool_use_id intentionally omitted
      },
    ];
    const { toolResults } = deriveTimeline(events);
    expect(toolResults['toolu_legacy']?.content).toBe('ok');
  });
});
