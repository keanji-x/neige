import { afterEach, describe, expect, it } from 'vitest';

import { AskUserQuestionHandler } from '../src/permissions/askUserQuestion.js';
import { _resetRegistryForTests, lookup, register } from '../src/permissions/registry.js';
import type { PermissionContext, RunnerContext, ToolPermissionHandler } from '../src/permissions/types.js';
import type { NeigeEvent } from '../src/types.js';

function makeRunnerCtx(sessionId = 'sess-1'): {
  ctx: RunnerContext;
  emitted: NeigeEvent[];
  pending: Map<string, (a: Record<string, string>) => void>;
} {
  const emitted: NeigeEvent[] = [];
  const pending = new Map<string, (a: Record<string, string>) => void>();
  return {
    emitted,
    pending,
    ctx: {
      sessionId,
      emit(ev) {
        emitted.push(ev);
      },
      pendingQuestions: pending,
    },
  };
}

function makePermCtx(runner: RunnerContext): PermissionContext {
  return { runner };
}

describe('registry', () => {
  afterEach(() => {
    _resetRegistryForTests();
    // Re-register the AskUserQuestion handler since module-level
    // self-registration only fires once per process.
    register(new AskUserQuestionHandler());
  });

  it('returns undefined for unregistered tools', () => {
    _resetRegistryForTests();
    expect(lookup('Bash')).toBeUndefined();
    expect(lookup('AskUserQuestion')).toBeUndefined();
  });

  it('returns the handler claiming the tool name', () => {
    _resetRegistryForTests();
    const h: ToolPermissionHandler = {
      toolNames: ['Foo', 'Bar'],
      async handle(_t, input) {
        return { behavior: 'allow', updatedInput: input };
      },
    };
    register(h);
    expect(lookup('Foo')).toBe(h);
    expect(lookup('Bar')).toBe(h);
    expect(lookup('Baz')).toBeUndefined();
  });

  it('AskUserQuestionHandler self-registers under "AskUserQuestion"', () => {
    expect(lookup('AskUserQuestion')).toBeInstanceOf(AskUserQuestionHandler);
  });
});

// The dispatcher logic lives inline in cli.ts (not exported), so we mirror
// it here to verify behavior. If you change cli.ts's canUseTool body, mirror
// the change in this fixture or extract the dispatcher to its own module.
async function dispatch(
  toolName: string,
  input: Record<string, unknown>,
  opts: { permissionMode?: string } | undefined,
  runner: RunnerContext,
): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
  const permissionMode = opts?.permissionMode as PermissionContext['permissionMode'];
  if (permissionMode === 'bypassPermissions') {
    return { behavior: 'allow', updatedInput: input };
  }
  const handler = lookup(toolName);
  if (handler) {
    return handler.handle(toolName, input, { permissionMode, runner });
  }
  return { behavior: 'allow', updatedInput: input };
}

describe('canUseTool dispatcher', () => {
  it('bypassPermissions short-circuits and returns allow with original input untouched', async () => {
    const { ctx, emitted } = makeRunnerCtx();
    const input = { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] };
    const result = await dispatch('AskUserQuestion', input, { permissionMode: 'bypassPermissions' }, ctx);
    expect(result).toEqual({ behavior: 'allow', updatedInput: input });
    // Important: the AskUserQuestion handler must NOT have run, so no event
    // should have been emitted.
    expect(emitted).toEqual([]);
  });

  it('default fallback: unregistered tool returns allow with original input', async () => {
    _resetRegistryForTests();
    const { ctx } = makeRunnerCtx();
    const input = { command: 'ls' };
    const result = await dispatch('Bash', input, undefined, ctx);
    expect(result).toEqual({ behavior: 'allow', updatedInput: input });
    register(new AskUserQuestionHandler()); // restore for other tests
  });
});

describe('AskUserQuestionHandler', () => {
  it('emits passthrough event with the parsed questions and resolves with answers', async () => {
    const { ctx, emitted, pending } = makeRunnerCtx('sess-42');
    const handler = new AskUserQuestionHandler();
    const input: Record<string, unknown> = {
      questions: [
        {
          question: 'Pick a color',
          header: 'color-q',
          multiSelect: false,
          options: [
            { label: 'red', description: 'warm', preview: '#f00' },
            { label: 'blue' },
          ],
        },
      ],
    };

    const promise = handler.handle('AskUserQuestion', input, makePermCtx(ctx));

    // The handler should have surfaced one passthrough event with the
    // chat-mode question schema and registered a resolver.
    expect(emitted).toHaveLength(1);
    const ev = emitted[0]!;
    expect(ev.type).toBe('passthrough');
    if (ev.type !== 'passthrough') throw new Error('unreachable');
    expect(ev.session_id).toBe('sess-42');
    expect(ev.kind).toBe('neige.ask_user_question');
    const payload = ev.payload as {
      schema: string;
      source: string;
      question_id: string;
      questions: Array<{ question: string; header?: string; multiSelect: boolean; options: Array<{ label: string }> }>;
    };
    expect(payload.schema).toBe('neige.ask_user_question.v1');
    expect(payload.source).toBe('sdk');
    expect(typeof payload.question_id).toBe('string');
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0]!.question).toBe('Pick a color');
    expect(payload.questions[0]!.header).toBe('color-q');
    expect(payload.questions[0]!.options).toEqual([
      { label: 'red', description: 'warm', preview: '#f00' },
      { label: 'blue', description: undefined, preview: undefined },
    ]);

    expect(pending.size).toBe(1);
    const [questionId, resolver] = [...pending.entries()][0]!;
    expect(questionId).toBe(payload.question_id);

    // Simulate the control-channel answer arriving.
    const answers = { 'Pick a color': 'red' };
    pending.delete(questionId);
    resolver(answers);

    const result = await promise;
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { ...input, answers },
    });
    // Critical: do NOT include `questions` in updatedInput (see commit
    // bcec8c8 — the SDK's strict zod parse rejects it because optional
    // fields serialize as undefined and drop on round-trip).
    if (result.behavior === 'allow') {
      expect(Object.keys(result.updatedInput)).toEqual(['questions', 'answers']);
      // `questions` here is the original input.questions, not parsed.questions.
      expect(result.updatedInput['questions']).toBe(input['questions']);
    }
  });

  it('falls through to allow with original input when the question shape is malformed', async () => {
    const { ctx, emitted, pending } = makeRunnerCtx();
    const handler = new AskUserQuestionHandler();
    const input: Record<string, unknown> = { questions: [] }; // empty -> null
    const result = await handler.handle('AskUserQuestion', input, makePermCtx(ctx));
    expect(result).toEqual({ behavior: 'allow', updatedInput: input });
    expect(emitted).toEqual([]);
    expect(pending.size).toBe(0);
  });
});
