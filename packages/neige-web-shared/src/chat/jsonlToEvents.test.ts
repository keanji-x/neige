// Tests for the Claude CLI jsonl → NeigeEvent[] adapter. The contract that
// matters is: feed adapter output to deriveTimeline and get back the timeline
// a colleague should see in the read-only share viewer.

import { describe, it, expect } from 'vitest';
import { jsonlToEvents } from './jsonlToEvents';
import { deriveTimeline } from './derive';

function jsonl(...lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

describe('jsonlToEvents', () => {
  it('skips environment + sidechain noise', () => {
    const text = jsonl(
      { type: 'permission-mode', permissionMode: 'default' },
      { type: 'file-history-snapshot', snapshot: {} },
      { type: 'attachment', attachment: { type: 'skill_listing' } },
      { type: 'summary', summary: 'whatever' },
      { type: 'system', subtype: 'init' },
      // Sidechain user/assistant lines (Task tool sub-agent transcripts) are
      // not part of the parent timeline and must not surface to the viewer.
      {
        type: 'user',
        isSidechain: true,
        message: { role: 'user', content: 'hidden subagent prompt' },
      },
    );
    expect(jsonlToEvents(text)).toEqual([]);
  });

  it('emits a user_message for plain string user content', () => {
    const text = jsonl({
      type: 'user',
      message: { role: 'user', content: 'hello' },
    });
    const events = jsonlToEvents(text);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'user_message',
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('expands an array of tool_results into one tool_result event each', () => {
    const text = jsonl({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'stdout body',
            is_error: false,
          },
          {
            type: 'tool_result',
            tool_use_id: 'tu_2',
            content: 'oops',
            is_error: true,
          },
        ],
      },
    });
    const events = jsonlToEvents(text);
    expect(events.map((e) => e.type)).toEqual(['tool_result', 'tool_result']);
    expect(events[0]).toMatchObject({ tool_use_id: 'tu_1', is_error: false });
    expect(events[1]).toMatchObject({ tool_use_id: 'tu_2', is_error: true });
  });

  it('coalesces multi-line assistant turn by message.id', () => {
    // The CLI logs each block as a separate jsonl line, all sharing a
    // message.id. The adapter must collapse them so deriveTimeline ends up
    // with one assistant message containing all blocks.
    const text = jsonl(
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [{ type: 'thinking', thinking: 'planning…' }],
          stop_reason: null,
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'Hello.' }],
          stop_reason: null,
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { cmd: 'ls' } },
          ],
          stop_reason: 'tool_use',
        },
      },
    );
    const { timeline } = deriveTimeline(jsonlToEvents(text));
    expect(timeline.messages).toHaveLength(1);
    const m = timeline.messages[0];
    if (m.role !== 'assistant') throw new Error('expected assistant message');
    expect(m.messageId).toBe('msg_1');
    expect(m.model).toBe('claude-opus-4-7');
    expect(m.blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(m.isComplete).toBe(true);
    expect(m.stopReason).toBe('tool_use');
    // All blocks should have isStreaming false after coalescing — share view
    // shows committed turns, not in-flight streaming.
    for (const b of m.blocks) {
      if (b.type !== 'unknown') {
        expect(b.isStreaming).toBe(false);
      }
    }
  });

  it('produces a full assistant + tool_result + follow-up cycle', () => {
    const text = jsonl(
      {
        type: 'user',
        message: { role: 'user', content: 'list files' },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          model: 'claude',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { cmd: 'ls' } },
          ],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: 'a\nb',
              is_error: false,
            },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_2',
          model: 'claude',
          role: 'assistant',
          content: [{ type: 'text', text: 'Two files.' }],
          stop_reason: 'end_turn',
        },
      },
    );
    const { timeline, toolResults } = deriveTimeline(jsonlToEvents(text));
    expect(timeline.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'assistant',
    ]);
    expect(toolResults['tu_1']?.content).toBe('a\nb');
  });

  it('drops malformed json lines silently', () => {
    const text = [
      '{not valid json',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'ok' } }),
      '',
      '   ',
    ].join('\n');
    const events = jsonlToEvents(text);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'user_message' });
  });
});
