/**
 * Per-tool permission handler shape, modelled on Microsoft's
 * vscode-copilot-chat (External/vscode-copilot-chat/.../claudeToolPermission.ts).
 *
 * The runner's `canUseTool` callback dispatches into this registry instead of
 * a single switch in cli.ts, so new tools (e.g. Bash confirmation, exit-plan)
 * can land as standalone files without touching the dispatcher.
 */
import type { PermissionMode, PermissionResult } from '@anthropic-ai/claude-agent-sdk';

import type { NeigeEvent } from '../types.js';

/**
 * Runner-specific seam threaded into every handler. Holds the bits the
 * AskUserQuestion handler needs to surface a passthrough event and resolve
 * an answer that arrives over the control channel.
 */
export interface RunnerContext {
  readonly sessionId: string;
  emit(ev: NeigeEvent): void;
  /**
   * Pending askUserQuestion resolvers keyed by question_id. The control reader's
   * `answer_question` frame deletes the matching entry and invokes its resolver;
   * the handler returns the answer to the SDK via `updatedInput.answers`.
   */
  readonly pendingQuestions: Map<string, (answers: Record<string, string>) => void>;
}

/**
 * Per-call context, mirroring the MS shape. `signal` and `permissionMode`
 * come from the SDK's `canUseTool` opts arg; `runner` is our seam.
 */
export interface PermissionContext {
  readonly signal?: AbortSignal;
  readonly permissionMode?: PermissionMode;
  readonly runner: RunnerContext;
}

export type ToolPermissionResult = PermissionResult;

/**
 * One handler can claim multiple tool names (cf. MS's `toolNames: readonly T[]`).
 * `handle` is the full custom path — no auto-approve / confirmation hook here
 * since the runner has no UI of its own; everything is delegated to the daemon
 * via passthrough events.
 */
export interface ToolPermissionHandler {
  readonly toolNames: readonly string[];
  handle(
    toolName: string,
    input: Record<string, unknown>,
    context: PermissionContext,
  ): Promise<ToolPermissionResult>;
}
