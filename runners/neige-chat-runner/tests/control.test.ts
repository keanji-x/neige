import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { dispatchLine, startControlReader, type ControlHandlers } from '../src/control.js';

function makeHandlers(): ControlHandlers & {
  userMessages: string[];
  stops: number;
  answers: Array<[string, string]>;
  eofs: number;
} {
  const userMessages: string[] = [];
  const answers: Array<[string, string]> = [];
  let stops = 0;
  let eofs = 0;
  return {
    userMessages,
    answers,
    get stops() {
      return stops;
    },
    get eofs() {
      return eofs;
    },
    onUserMessage(content) {
      userMessages.push(content);
    },
    onStop() {
      stops += 1;
    },
    onAnswerQuestion(qid, answer) {
      answers.push([qid, answer]);
    },
    onEof() {
      eofs += 1;
    },
  };
}

describe('dispatchLine', () => {
  it('routes user_message frames', () => {
    const h = makeHandlers();
    dispatchLine('{"kind":"user_message","content":"hi"}', h);
    expect(h.userMessages).toEqual(['hi']);
  });

  it('routes stop frames', () => {
    const h = makeHandlers();
    dispatchLine('{"kind":"stop"}', h);
    expect(h.stops).toBe(1);
  });

  it('routes answer_question frames', () => {
    const h = makeHandlers();
    dispatchLine('{"kind":"answer_question","question_id":"q1","answer":"yes"}', h);
    expect(h.answers).toEqual([['q1', 'yes']]);
  });

  it('drops malformed JSON without throwing', () => {
    const h = makeHandlers();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    dispatchLine('not json {', h);
    expect(h.userMessages).toEqual([]);
    expect(h.stops).toBe(0);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('drops unknown kinds without throwing', () => {
    const h = makeHandlers();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    dispatchLine('{"kind":"bogus","x":1}', h);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('drops user_message missing content', () => {
    const h = makeHandlers();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    dispatchLine('{"kind":"user_message"}', h);
    expect(h.userMessages).toEqual([]);
    stderr.mockRestore();
  });

  it('drops answer_question with non-string fields', () => {
    const h = makeHandlers();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    dispatchLine('{"kind":"answer_question","question_id":1,"answer":"x"}', h);
    expect(h.answers).toEqual([]);
    stderr.mockRestore();
  });
});

describe('startControlReader', () => {
  it('processes multi-line NDJSON streams and resolves on EOF', async () => {
    const h = makeHandlers();
    const input = Readable.from([
      '{"kind":"user_message","content":"first"}\n',
      '\n', // blank line — must be ignored
      '{"kind":"user_message","content":"second"}\n',
      '{"kind":"stop"}\n',
    ]);
    await startControlReader(input, h);
    expect(h.userMessages).toEqual(['first', 'second']);
    expect(h.stops).toBe(1);
    expect(h.eofs).toBe(1);
  });

  it('survives a malformed line in the middle of the stream', async () => {
    const h = makeHandlers();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const input = Readable.from([
      '{"kind":"user_message","content":"a"}\n',
      'garbage{not}json\n',
      '{"kind":"user_message","content":"b"}\n',
    ]);
    await startControlReader(input, h);
    expect(h.userMessages).toEqual(['a', 'b']);
    expect(h.eofs).toBe(1);
    stderr.mockRestore();
  });
});
