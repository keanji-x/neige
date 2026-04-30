#!/usr/bin/env node
/**
 * Headless end-to-end probe for the AskUserQuestion round-trip.
 *
 * Spawns the real runner (`dist/cli.js`) as a subprocess with stdio
 * piped, drives it like a fake daemon: writes a `user_message` control
 * frame to ask the model to use AskUserQuestion, watches stdout for the
 * `neige.ask_user_question` passthrough, sends an `answer_question`
 * frame back, then verifies the model continues with a "DONE: ..."
 * assistant text.
 *
 * Costs one Anthropic API round-trip (~$0.01). Auth via the same
 * `~/.claude/.credentials.json` Claude Code uses.
 *
 *   node tests/manual/aq_headless.mjs
 *
 * Exit 0 = passed, 1 = failed. Prints a structured timeline either way.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '..', '..', 'dist', 'cli.js');
const TIMEOUT_MS = 90_000;

const SESSION_ID = randomUUID();
const TMP = mkdtempSync(path.join(tmpdir(), 'neige-aq-'));
const LOG_PATH = path.join(TMP, 'runner.log');

// Force 4-question case to mirror the user's actual repro (Q&A scope,
// Todo tool, dual approach, fix-bugs). Each question needs >=2 options.
const PROMPT = `You are a test harness. Use the AskUserQuestion tool **exactly once** with these 4 questions in a single call:

  questions: [
    { "question": "Validation scope?",   "header": "Scope",     "multiSelect": false, "options": [{"label":"Q&A flow","description":""},{"label":"Todo tool","description":""}] },
    { "question": "How to validate?",     "header": "How",       "multiSelect": false, "options": [{"label":"Headless","description":""},{"label":"Manual","description":""}] },
    { "question": "Which agent?",         "header": "Agent",     "multiSelect": false, "options": [{"label":"Echo/Mock","description":""},{"label":"Real Claude","description":""}] },
    { "question": "Bug handling?",        "header": "Bugs",      "multiSelect": false, "options": [{"label":"Fix all","description":""},{"label":"Report only","description":""}] }
  ]

The tool will return answers. After you receive the tool's tool_result, respond with EXACTLY this text and stop:

  DONE: <comma-separated answers>

Do not call AskUserQuestion a second time. Do not use any other tools.`;

console.error(`[probe] session=${SESSION_ID}`);
console.error(`[probe] log=${LOG_PATH}`);
console.error(`[probe] cli=${CLI_PATH}`);

const child = spawn(
  'node',
  [
    CLI_PATH,
    '--session-id', SESSION_ID,
    '--cwd', TMP,
  ],
  {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NEIGE_RUNNER_LOG: '1',
      NEIGE_RUNNER_LOG_PATH: LOG_PATH,
    },
  },
);

const events = [];
let questionId = null;
let assistantText = '';
let sawAnswerSent = false;
let sawTextAfterAnswer = false;
let resolved = false;

const timeline = [];
function step(label, extra = '') {
  const line = `[${(Date.now() - START).toString().padStart(5, ' ')}ms] ${label}${extra ? ' ' + extra : ''}`;
  timeline.push(line);
  console.error(line);
}
const START = Date.now();

child.stderr.on('data', (chunk) => {
  process.stderr.write(`[runner stderr] ${chunk}`);
});

let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    handleEvent(ev);
  }
});

function handleEvent(ev) {
  events.push(ev);

  if (ev.type === 'passthrough' && ev.kind === 'neige.ask_user_question') {
    questionId = ev.payload?.question_id;
    step('passthrough neige.ask_user_question', `qid=${questionId}`);
    sendAnswer();
    return;
  }

  if (ev.type === 'assistant_text_delta') {
    if (sawAnswerSent) {
      assistantText += ev.text;
      if (!sawTextAfterAnswer) {
        sawTextAfterAnswer = true;
        step('first assistant_text_delta after answer', `text=${JSON.stringify(ev.text.slice(0, 60))}`);
      }
    }
    return;
  }

  if (ev.type === 'assistant_content_block_start' && ev.block?.type === 'tool_use') {
    step('assistant tool_use', `name=${ev.block.name} id=${ev.block.id}`);
    return;
  }

  if (ev.type === 'tool_result') {
    const content = typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content);
    step('tool_result', `id=${ev.tool_use_id} is_error=${ev.is_error} content=${content.slice(0, 120)}`);
    return;
  }

  if (ev.type === 'result') {
    step('result', `subtype=${ev.subtype} is_error=${ev.is_error}`);
    finalize();
    return;
  }

  if (ev.type === 'session_init') {
    step('session_init', `model=${ev.model}`);
    return;
  }

  if (ev.type === 'status_change') {
    step('status_change', `status=${ev.status}`);
    return;
  }
}

function sendControl(frame) {
  child.stdin.write(JSON.stringify(frame) + '\n');
}

function sendAnswer() {
  if (!questionId) return;
  // Match the 4-question prompt: pick the first option of each.
  const answers = {
    'Validation scope?': 'Q&A flow',
    'How to validate?': 'Headless',
    'Which agent?': 'Echo/Mock',
    'Bug handling?': 'Fix all',
  };
  step('-> answer_question', `qid=${questionId} answers=${JSON.stringify(answers)}`);
  sendControl({ kind: 'answer_question', question_id: questionId, answers });
  sawAnswerSent = true;
}

function finalize() {
  if (resolved) return;
  resolved = true;

  step('finalize', `events=${events.length}`);

  // Close stdin so runner exits cleanly
  child.stdin.end();
  setTimeout(() => child.kill('SIGTERM'), 2000).unref();

  const passDoneText = /DONE\s*:/i.test(assistantText);
  const passToolResult = events.some(
    (e) => e.type === 'tool_result' && !e.is_error &&
           typeof e.content === 'string' && /User has answered/i.test(e.content),
  );

  console.error('\n=== TIMELINE ===');
  for (const line of timeline) console.error(line);

  console.error('\n=== ASSERTIONS ===');
  console.error(`  passthrough question received     : ${questionId ? 'PASS' : 'FAIL'}`);
  console.error(`  answer sent on stdin              : ${sawAnswerSent ? 'PASS' : 'FAIL'}`);
  console.error(`  tool_result with "User has answered": ${passToolResult ? 'PASS' : 'FAIL'}`);
  console.error(`  text after answer received        : ${sawTextAfterAnswer ? 'PASS' : 'FAIL'}`);
  console.error(`  final text contains DONE          : ${passDoneText ? 'PASS' : 'FAIL'}`);
  console.error(`  final text                        : ${JSON.stringify(assistantText.slice(0, 200))}`);

  console.error('\n=== RUNNER LOG ===');
  try {
    console.error(readFileSync(LOG_PATH, 'utf8'));
  } catch (e) {
    console.error(`(failed to read log: ${e.message})`);
  }

  const ok = !!questionId && sawAnswerSent && passToolResult && passDoneText;
  console.error(`\n=== RESULT: ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
}

child.on('exit', (code, signal) => {
  step('child exit', `code=${code} signal=${signal}`);
  if (!resolved) finalize();
});

child.on('error', (err) => {
  console.error(`[probe] spawn error: ${err.message}`);
  process.exit(2);
});

// Send the user message right after spawn
setTimeout(() => {
  step('-> user_message');
  sendControl({ kind: 'user_message', content: PROMPT });
}, 200);

// Hard timeout
setTimeout(() => {
  if (!resolved) {
    step('TIMEOUT');
    finalize();
  }
}, TIMEOUT_MS);
