// Hardcoded fixture exercising the major event shapes: session_init, a user
// turn, an assistant turn with thinking + text + tool_use + tool_result +
// more text, then a final result. Realistic-ish content; chunked to simulate
// streaming deltas without actually being streamed (the reducer folds them
// the same way either way).

import type { NeigeEvent } from '../types';

const SESSION = 'demo-session';
const MSG = 'demo-msg-1';
const TOOL_USE_ID = 'toolu_01ABCxyz';

export const mockEvents: NeigeEvent[] = [
  {
    type: 'session_init',
    session_id: SESSION,
    model: 'claude-sonnet-4-5',
    permission_mode: 'default',
    cwd: '/home/kenji/neige-mode-b',
    version: '2.1.0',
    tools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
    mcp_servers: [],
    slash_commands: ['/help', '/clear'],
    agents: [],
    skills: [],
    plugins: [],
  },
  {
    type: 'user_message',
    session_id: SESSION,
    content: [
      {
        type: 'text',
        text: 'What does the App component render? Read web/src/App.tsx and summarize.',
      },
    ],
  },
  {
    type: 'assistant_message_start',
    session_id: SESSION,
    message_id: MSG,
    model: 'claude-sonnet-4-5',
    parent_tool_use_id: null,
  },
  // thinking block
  {
    type: 'assistant_content_block_start',
    session_id: SESSION,
    message_id: MSG,
    index: 0,
    block: { type: 'thinking', thinking: '' },
  },
  {
    type: 'assistant_thinking_delta',
    session_id: SESSION,
    message_id: MSG,
    index: 0,
    text: 'The user wants a summary of App.tsx. ',
  },
  {
    type: 'assistant_thinking_delta',
    session_id: SESSION,
    message_id: MSG,
    index: 0,
    text: 'I should read the file first to give an accurate answer rather than guessing.',
  },
  {
    type: 'assistant_content_block_stop',
    session_id: SESSION,
    message_id: MSG,
    index: 0,
  },
  // intro text
  {
    type: 'assistant_content_block_start',
    session_id: SESSION,
    message_id: MSG,
    index: 1,
    block: { type: 'text', text: '' },
  },
  {
    type: 'assistant_text_delta',
    session_id: SESSION,
    message_id: MSG,
    index: 1,
    text: "I'll read the file to be sure.",
  },
  {
    type: 'assistant_content_block_stop',
    session_id: SESSION,
    message_id: MSG,
    index: 1,
  },
  // tool_use Read — input streamed as partial json
  {
    type: 'assistant_content_block_start',
    session_id: SESSION,
    message_id: MSG,
    index: 2,
    block: { type: 'tool_use', id: TOOL_USE_ID, name: 'Read', input: {} },
  },
  {
    type: 'assistant_tool_use_input_delta',
    session_id: SESSION,
    message_id: MSG,
    index: 2,
    partial_json: '{"file_path":',
  },
  {
    type: 'assistant_tool_use_input_delta',
    session_id: SESSION,
    message_id: MSG,
    index: 2,
    partial_json: '"/home/kenji/neige-mode-b/web/src/App.tsx"}',
  },
  {
    type: 'assistant_content_block_stop',
    session_id: SESSION,
    message_id: MSG,
    index: 2,
  },
  // matching tool_result
  {
    type: 'tool_result',
    session_id: SESSION,
    tool_use_id: TOOL_USE_ID,
    content:
      '1\timport { useState } from "react";\n' +
      '2\timport { Sidebar } from "./components/Sidebar";\n' +
      '3\timport { TerminalPanel } from "./components/TerminalPanel";\n' +
      '...\n315\texport default App;',
    is_error: false,
  },
  // closing assistant text after the tool ran
  {
    type: 'assistant_content_block_start',
    session_id: SESSION,
    message_id: MSG,
    index: 3,
    block: { type: 'text', text: '' },
  },
  {
    type: 'assistant_text_delta',
    session_id: SESSION,
    message_id: MSG,
    index: 3,
    text:
      '\nApp.tsx is the top-level shell:\n\n' +
      '- It owns conversation state via the useConversations hook and config via useConfig.\n' +
      '- Renders a Sidebar on the left and a TerminalPanel (dockview) on the right.\n' +
      '- Hosts global dialogs: CreateDialog, FilePicker, QuickLauncher, URL input, ConfirmDialog.\n' +
      '- Wires global hotkeys: Cmd+P (file picker), Cmd+N (quick launcher), Cmd+L (URL input), Ctrl+W (close file panel).\n',
  },
  {
    type: 'assistant_content_block_stop',
    session_id: SESSION,
    message_id: MSG,
    index: 3,
  },
  {
    type: 'assistant_message_delta',
    session_id: SESSION,
    message_id: MSG,
    stop_reason: 'end_turn',
    usage: { input_tokens: 1234, output_tokens: 256 },
  },
  { type: 'assistant_message_stop', session_id: SESSION, message_id: MSG },
  {
    type: 'result',
    session_id: SESSION,
    subtype: 'success',
    is_error: false,
    duration_ms: 4820,
    total_cost_usd: 0.0153,
    terminal_reason: 'end_turn',
    permission_denials: [],
  },
];
