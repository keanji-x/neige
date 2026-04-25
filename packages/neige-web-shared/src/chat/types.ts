/*
 * Wire types for the unified Claude-Code event stream.
 *
 * These mirror the Rust `NeigeEvent` enum with serde's default snake_case
 * tagging. Keep field names in lockstep with the backend — the wire format
 * is consumed as-is, no client-side renaming.
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
 * Untagged on the wire (matches Anthropic Messages API): either a bare
 * string for the common short-text case, or a bare array of nested blocks
 * for multi-part / image returns. Use `Array.isArray(content)` to branch.
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
  | { type: 'user_message'; session_id: string; content: ContentBlock[] }
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
    };

export type NeigeEventType = NeigeEvent['type'];
