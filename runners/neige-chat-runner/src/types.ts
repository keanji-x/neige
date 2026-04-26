/**
 * NeigeEvent wire types — kept in lockstep with:
 *   - packages/neige-web-shared/src/chat/types.ts (TS frontend consumer)
 *   - crates/neige-session/src/stream_json/unified.rs (Rust source of truth)
 *
 * The shape on the wire is what the daemon's chat WebSocket layer forwards
 * verbatim to the browser. Adding/removing/renaming a field here without
 * matching changes in those two locations will break the wire contract.
 */

export interface McpServerInfo {
  name: string;
  status: string;
}

export interface PluginInfo {
  name: string;
  source: string | null;
}

/**
 * `tool_result.content` is polymorphic: bare string for short text, or an
 * array of nested content blocks for image / multi-part returns.
 */
export type ToolResultContent = string | ContentBlock[];

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: ToolResultContent; is_error: boolean }
  | { type: 'image'; source: unknown }
  | { type: 'unknown'; type_name: string; value: unknown };

export type NeigeEvent =
  | {
      type: 'session_init';
      session_id: string;
      model: string;
      permission_mode: string;
      cwd: string;
      version: string;
      tools: string[];
      mcp_servers: McpServerInfo[];
      slash_commands: string[];
      agents: string[];
      skills: string[];
      plugins: PluginInfo[];
    }
  | { type: 'status_change'; session_id: string; status: string }
  | { type: 'rate_limit'; session_id: string; info: unknown }
  | {
      type: 'user_message';
      session_id: string;
      content: ContentBlock[];
      /**
       * `string` when this user turn was synthesized by the SDK as the
       * prompt for a sub-agent spawned by a `Task` tool call; `null` for
       * top-level user input. The frontend uses it to bucket the event
       * into the right (sub-)timeline.
       *
       * Optional on the wire so older payloads that pre-date this field
       * still parse — `derive.ts` treats `undefined` as `null`.
       */
      parent_tool_use_id?: string | null;
    }
  | {
      type: 'assistant_message_start';
      session_id: string;
      message_id: string;
      model: string;
      parent_tool_use_id: string | null;
    }
  | {
      type: 'assistant_content_block_start';
      session_id: string;
      message_id: string;
      index: number;
      block: ContentBlock;
    }
  | {
      type: 'assistant_text_delta';
      session_id: string;
      message_id: string;
      index: number;
      text: string;
    }
  | {
      type: 'assistant_thinking_delta';
      session_id: string;
      message_id: string;
      index: number;
      text: string;
    }
  | {
      type: 'assistant_tool_use_input_delta';
      session_id: string;
      message_id: string;
      index: number;
      partial_json: string;
    }
  | {
      type: 'assistant_content_block_stop';
      session_id: string;
      message_id: string;
      index: number;
    }
  | {
      type: 'assistant_message_delta';
      session_id: string;
      message_id: string;
      stop_reason: string | null;
      usage: unknown;
    }
  | { type: 'assistant_message_stop'; session_id: string; message_id: string }
  | { type: 'assistant_checkpoint'; session_id: string; message: unknown }
  | {
      type: 'tool_result';
      session_id: string;
      tool_use_id: string;
      content: ToolResultContent;
      is_error: boolean;
      /**
       * `string` when this result completes a tool call that happened
       * *inside* a sub-agent; `null` for top-level results.
       *
       * Optional on the wire so older payloads still parse — `derive.ts`
       * treats `undefined` as `null`.
       */
      parent_tool_use_id?: string | null;
    }
  | {
      type: 'result';
      session_id: string;
      subtype: string;
      is_error: boolean;
      duration_ms: number;
      total_cost_usd: number;
      terminal_reason: string;
      permission_denials: unknown[];
    }
  | {
      type: 'passthrough';
      session_id: string;
      kind: string;
      payload: unknown;
    };

export type NeigeEventType = NeigeEvent['type'];

/**
 * Frames the daemon writes to the runner over stdin (NDJSON, one per line).
 * See package README / Track A brief for the contract.
 */
export type ControlFrame =
  | { kind: 'user_message'; content: string }
  | { kind: 'stop' }
  | { kind: 'answer_question'; question_id: string; answer: string };
