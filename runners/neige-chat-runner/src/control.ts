/**
 * stdin NDJSON reader / dispatcher.
 *
 * The daemon writes one JSON frame per line; we route each frame to a
 * handler. Unknown / malformed lines are logged to stderr and dropped —
 * never crash the runner on a single bad line.
 */
import readline from 'node:readline';
import type { Readable } from 'node:stream';

import type { ControlFrame } from './types.js';

export interface ControlHandlers {
  onUserMessage(content: string): void;
  onStop(): void;
  onAnswerQuestion(questionId: string, answer: string): void;
  /**
   * Called once stdin reaches EOF. The runner uses this to close the
   * SDK prompt iterable so the query can drain naturally.
   */
  onEof(): void;
}

/**
 * Begin reading frames from `input` and dispatching to `handlers`.
 *
 * Returns a Promise that resolves on EOF (or rejects on a fatal stream
 * error). Caller is expected to await it for the lifetime of the
 * runner — dispatchers run synchronously off the readline event loop.
 */
export function startControlReader(input: Readable, handlers: ControlHandlers): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      dispatchLine(trimmed, handlers);
    });
    rl.on('close', () => {
      handlers.onEof();
      resolve();
    });
    rl.on('error', (err) => {
      reject(err);
    });
  });
}

/** Internal: parse one line and route to the right handler. Exported for tests. */
export function dispatchLine(line: string, handlers: ControlHandlers): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    process.stderr.write(
      `[neige-chat-runner] control: dropping malformed JSON line: ${(err as Error).message}\n`,
    );
    return;
  }
  if (!isControlFrame(parsed)) {
    process.stderr.write(
      `[neige-chat-runner] control: dropping line with unknown shape: ${line.slice(0, 200)}\n`,
    );
    return;
  }
  switch (parsed.kind) {
    case 'user_message':
      handlers.onUserMessage(parsed.content);
      return;
    case 'stop':
      handlers.onStop();
      return;
    case 'answer_question':
      handlers.onAnswerQuestion(parsed.question_id, parsed.answer);
      return;
  }
}

function isControlFrame(value: unknown): value is ControlFrame {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  switch (obj['kind']) {
    case 'user_message':
      return typeof obj['content'] === 'string';
    case 'stop':
      return true;
    case 'answer_question':
      return typeof obj['question_id'] === 'string' && typeof obj['answer'] === 'string';
    default:
      return false;
  }
}
