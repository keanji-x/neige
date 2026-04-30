/**
 * Handler for the SDK's built-in `AskUserQuestion` tool.
 *
 * Mirrors MS's `AskUserQuestionHandler`: parse the input, surface the
 * structured question to the browser via a passthrough NeigeEvent, await
 * the user's answer over the control channel, and return it via the SDK's
 * `{ behavior: 'allow', updatedInput }` contract.
 */
import { v4 as uuidv4 } from 'uuid';

import { debug } from '../debug.js';
import { register } from './registry.js';
import type {
  PermissionContext,
  ToolPermissionHandler,
  ToolPermissionResult,
} from './types.js';

type AskUserOption = {
  label: string;
  description?: string;
  preview?: string;
};

type AskUserQuestion = {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: AskUserOption[];
};

export class AskUserQuestionHandler implements ToolPermissionHandler {
  public readonly toolNames = ['AskUserQuestion'] as const;

  public async handle(
    _toolName: string,
    input: Record<string, unknown>,
    context: PermissionContext,
  ): Promise<ToolPermissionResult> {
    debug(`AskUserQuestion.handle: input=${JSON.stringify(input).slice(0, 400)}`);
    const parsed = parseAskUserQuestionInput(input);
    if (!parsed) {
      debug('AskUserQuestion.handle: parseAskUserQuestionInput returned null, falling through');
      // Input shape didn't match — fall through to allow-all so the built-in
      // tool runs its placeholder path. Strictly no worse than today's deny.
      return { behavior: 'allow', updatedInput: input };
    }
    debug(`AskUserQuestion.handle: parsed ${parsed.questions.length} question(s)`);

    const answers = await askUserQuestion(context, parsed.questions);
    debug(`AskUserQuestion.handle: got answers=${JSON.stringify(answers)}`);

    // Why: only `answers` is appended. Including `questions: parsed.questions`
    // breaks the SDK's strict zod parse on updatedInput because optional
    // fields (e.g. `header`) get serialized as `undefined` and dropped during
    // round-trip. Commit bcec8c8 introduced that override; do not reintroduce.
    const result: ToolPermissionResult = {
      behavior: 'allow',
      updatedInput: {
        ...input,
        answers,
      },
    };
    debug(`AskUserQuestion.handle: returning updatedInput keys=${Object.keys(result.updatedInput ?? {}).join(',')}`);
    return result;
  }
}

/**
 * Surface a structured AskUserQuestion to the browser via a passthrough
 * NeigeEvent and block until the user picks an option (or types a free-form
 * answer). The payload is the chat-mode question schema:
 *   `{ schema, source, question_id, questions }`.
 */
function askUserQuestion(
  context: PermissionContext,
  questions: AskUserQuestion[],
): Promise<Record<string, string>> {
  const questionId = uuidv4();
  return new Promise<Record<string, string>>((resolve) => {
    context.runner.pendingQuestions.set(questionId, resolve);
    debug(`askUserQuestion: emitting passthrough qid=${questionId} questions=${questions.length}`);
    context.runner.emit({
      type: 'passthrough',
      session_id: context.runner.sessionId,
      kind: 'neige.ask_user_question',
      payload: {
        schema: 'neige.ask_user_question.v1',
        source: 'sdk',
        question_id: questionId,
        questions,
      },
    });
  });
}

/**
 * Pull the official `questions[]` shape out of an AskUserQuestion input,
 * defensive about partial / malformed shapes. Returns null if we can't
 * find at least one usable question — caller falls through to the default
 * permission verdict.
 */
function parseAskUserQuestionInput(
  input: Record<string, unknown>,
): { questions: AskUserQuestion[] } | null {
  const questions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const parsed: AskUserQuestion[] = [];
  for (const raw of questions) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const qr = raw as Record<string, unknown>;
    const q = qr['question'];
    if (typeof q !== 'string' || q.length === 0) return null;
    const rawOpts = qr['options'];
    if (!Array.isArray(rawOpts)) return null;
    const options: AskUserOption[] = [];
    for (const o of rawOpts) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      const or = o as Record<string, unknown>;
      const label = or['label'];
      if (typeof label !== 'string' || label.length === 0) return null;
      options.push({
        label,
        description: typeof or['description'] === 'string' ? or['description'] : undefined,
        preview: typeof or['preview'] === 'string' ? or['preview'] : undefined,
      });
    }
    parsed.push({
      question: q,
      header: typeof qr['header'] === 'string' ? qr['header'] : undefined,
      multiSelect: typeof qr['multiSelect'] === 'boolean' ? qr['multiSelect'] : false,
      options,
    });
  }
  return { questions: parsed };
}

// Self-register the handler (mirrors MS's `registerToolPermissionHandler`
// call at the bottom of askUserQuestionHandler.ts).
register(new AskUserQuestionHandler());
