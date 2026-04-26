#!/usr/bin/env node
/**
 * neige-chat-runner — sidecar entry point.
 *
 * The neige Rust daemon (`crates/neige-session/src/bin/daemon.rs`)
 * spawns this binary with stdio piped, then forwards WebSocket frames
 * between the runner and the chat client. We:
 *
 *   1. Parse argv (session id, cwd, optional resume / mcp-config /
 *      program override).
 *   2. Set up an async-iterable prompt queue backed by stdin frames.
 *   3. Drive the SDK's `query()` and translate each emitted SDKMessage
 *      to a NeigeEvent on stdout.
 *   4. Exit on stdin EOF or when `query()` ends naturally.
 *
 * Wire contract is documented at the top of the package README and
 * pinned by Track A; do not change without coordinating with Tracks B
 * and C (Rust daemon + frontend).
 */
import fs from 'node:fs';
import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import {
  query,
  type Options,
  type PermissionResult,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import { startControlReader } from './control.js';
import { mapSdkMessage } from './mapper.js';
import { AsyncQueue } from './queue.js';
import type { NeigeEvent } from './types.js';

interface ParsedArgs {
  sessionId: string;
  cwd: string;
  resume: boolean;
  mcpConfig: string | undefined;
  /**
   * Currently informational only. The SDK spawns its own bundled `claude`
   * binary; we keep this flag so the daemon's spawn contract has parity
   * with the legacy stream-json path. Surfacing it as an SDK option
   * (`pathToClaudeCodeExecutable`) is straightforward when we want to
   * honor it.
   */
  program: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const program = new Command();
  program
    .name('neige-chat-runner')
    .description('Sidecar that drives Claude Code via @anthropic-ai/claude-agent-sdk and emits NeigeEvent NDJSON.')
    .requiredOption('--session-id <uuid>', 'session UUID; stamped on every emitted event')
    .requiredOption('--cwd <path>', 'working directory passed through to the SDK')
    .option('--resume', 'resume an existing session (use with the same --session-id)', false)
    .option('--mcp-config <path>', 'path to a JSON file with `{"mcpServers":{...}}` (claude-CLI shape)')
    .option('--program <path>', 'optional override for the claude executable (informational; SDK bundles its own)')
    .exitOverride();

  try {
    program.parse(argv);
  } catch (err) {
    // commander.exitOverride() throws on --help / --version (success
    // exits) and on parse errors (non-zero). For success cases (code
    // 0) commander has already printed help to stdout — exit cleanly
    // without an extra stderr line. Real parse failures get a message
    // and a fixed exit code 2 (Track A wire contract).
    const code = (err as { exitCode?: number }).exitCode ?? 2;
    if (code === 0) {
      process.exit(0);
    }
    process.stderr.write(`[neige-chat-runner] failed to parse args: ${(err as Error).message}\n`);
    process.exit(2);
  }

  const opts = program.opts<{
    sessionId: string;
    cwd: string;
    resume: boolean;
    mcpConfig?: string;
    program?: string;
  }>();

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(opts.sessionId)) {
    process.stderr.write(`[neige-chat-runner] --session-id must be a UUID, got: ${opts.sessionId}\n`);
    process.exit(2);
  }

  return {
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    resume: opts.resume === true,
    mcpConfig: opts.mcpConfig,
    program: opts.program,
  };
}

/**
 * Read `{"mcpServers":{...}}` JSON and return the `mcpServers` block
 * verbatim, suitable to drop into `Options.mcpServers`.
 *
 * The SDK's accepted entry shapes (`McpStdioServerConfig`,
 * `McpSSEServerConfig`, `McpHttpServerConfig`) match the claude-CLI
 * `--mcp-config` JSON shapes 1:1 (verified against
 * `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` in this
 * package), so a verbatim pass-through is correct today. If a future
 * SDK adds a divergent field we'll detect it via `strictMcpConfig`-
 * style errors at startup; we deliberately don't pre-validate here so
 * the contract stays "claude-CLI shapes work as-is".
 */
function loadMcpConfig(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (err) {
    process.stderr.write(
      `[neige-chat-runner] failed to read --mcp-config ${path}: ${(err as Error).message}\n`,
    );
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[neige-chat-runner] failed to parse --mcp-config ${path}: ${(err as Error).message}\n`,
    );
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('mcpServers' in parsed) ||
    typeof (parsed as { mcpServers: unknown }).mcpServers !== 'object' ||
    (parsed as { mcpServers: unknown }).mcpServers === null
  ) {
    process.stderr.write(
      `[neige-chat-runner] --mcp-config ${path}: expected {"mcpServers":{...}}\n`,
    );
    return undefined;
  }
  return (parsed as { mcpServers: Record<string, unknown> }).mcpServers;
}

/**
 * Write one NeigeEvent as a single NDJSON line. Errors here are
 * non-recoverable — stdout is the daemon's only view of the runner.
 */
function emit(ev: NeigeEvent): void {
  process.stdout.write(JSON.stringify(ev) + '\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Stage the prompt iterable. Items pushed before query() runs the
  // first iteration are buffered in the queue, so eager construction
  // is safe.
  const promptQueue = new AsyncQueue<SDKUserMessage>();

  // Tracks pending askUserQuestion resolvers keyed by question_id.
  // Today nothing populates this — the canUseTool path is allow-all —
  // but `awaitUserAnswer` below is the seam for the future MCP-based
  // ask-tool. Wired now so the control-channel `answer_question` frame
  // already routes correctly.
  const pendingQuestions = new Map<string, (answer: string) => void>();

  const awaitUserAnswer = (promptText: string): Promise<string> => {
    const questionId = uuidv4();
    return new Promise<string>((resolve) => {
      pendingQuestions.set(questionId, resolve);
      emit({
        type: 'passthrough',
        session_id: args.sessionId,
        kind: 'ask_user_question',
        payload: { question_id: questionId, prompt: promptText },
      });
    });
  };
  // Mark as intentionally retained — exported via closure for the future
  // MCP ask-tool integration (see step 5 of the Track A brief).
  void awaitUserAnswer;

  // -- canUseTool: allow-all for now, with a clean seam for later -----------
  const canUseTool: NonNullable<Options['canUseTool']> = async (
    _toolName,
    input,
  ): Promise<PermissionResult> => {
    return { behavior: 'allow', updatedInput: input };
  };

  // -- mcp servers ----------------------------------------------------------
  let mcpServers: Options['mcpServers'] | undefined;
  if (args.mcpConfig) {
    const block = loadMcpConfig(args.mcpConfig);
    if (block) {
      // Pass through verbatim. The SDK accepts the same per-server
      // shapes (stdio / sse / http) as the claude-CLI `--mcp-config`
      // file, so no translation needed today. See loadMcpConfig() comment.
      mcpServers = block as Options['mcpServers'];
    }
  }

  // -- options --------------------------------------------------------------
  const options: Options = {
    cwd: args.cwd,
    includePartialMessages: true,
    includeHookEvents: true,
    // Parity with the existing Rust path until we have an MCP-based
    // replacement (see chat-mode-followups context).
    disallowedTools: ['AskUserQuestion'],
    canUseTool,
    ...(args.resume ? { resume: args.sessionId } : { sessionId: args.sessionId }),
    ...(mcpServers ? { mcpServers } : {}),
  };

  // -- start control reader (stdin → queue) --------------------------------
  let stopped = false;
  const controlPromise = startControlReader(process.stdin, {
    onUserMessage(content) {
      if (stopped) return;
      const userMsg: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content },
        parent_tool_use_id: null,
        session_id: args.sessionId,
      };
      promptQueue.push(userMsg);
    },
    onStop() {
      stopped = true;
      promptQueue.close();
    },
    onAnswerQuestion(questionId, answer) {
      const resolver = pendingQuestions.get(questionId);
      if (!resolver) {
        process.stderr.write(
          `[neige-chat-runner] answer_question: unknown question_id ${questionId}\n`,
        );
        return;
      }
      pendingQuestions.delete(questionId);
      resolver(answer);
    },
    onEof() {
      promptQueue.close();
    },
  });

  // -- drive the SDK --------------------------------------------------------
  const q = query({
    prompt: promptQueue,
    options,
  });

  let exitCode = 0;
  try {
    for await (const sdkMsg of q) {
      const events = mapSdkMessage(sdkMsg, args.sessionId);
      for (const ev of events) emit(ev);
    }
  } catch (err) {
    process.stderr.write(
      `[neige-chat-runner] query() failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    exitCode = 1;
  }

  // Drain the control reader if it hasn't already finished. We don't
  // await indefinitely — once query() has stopped, stdin EOF is the
  // only thing keeping the reader alive and the daemon will close it.
  promptQueue.close();
  await controlPromise.catch((err) => {
    process.stderr.write(
      `[neige-chat-runner] control reader: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(
    `[neige-chat-runner] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
