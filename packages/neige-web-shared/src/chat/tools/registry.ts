// Pluggable renderer registry for tool_use blocks. Lookup is exact-match on
// the tool name; miss returns null so callers can fall back to DefaultToolCard.

import type { ReactNode } from 'react';
import type { ChatTimeline, ToolResultsById } from '../derive';
import type { AnswerQuestionHandler, ToolResultContent } from '../types';

export interface ToolRendererProps {
  name: string;
  input: unknown;
  isStreaming: boolean;
  result?: { content: ToolResultContent; isError: boolean };
  respond: (text: string) => void;
  /**
   * Stable Anthropic-issued id for this tool_use block. Threaded through so
   * renderers can correlate with sub-agent timelines (`Task`), look up
   * extra state, or generate stable React keys for nested content.
   */
  toolUseId: string;
  /**
   * The sub-agent ChatTimeline this tool call spawned, if any. Populated
   * by ToolUseBlock from the enclosing timeline's `subagents` map keyed
   * by `toolUseId`. Only `TaskToolCard` consumes this today; other
   * renderers safely ignore it.
   */
  subagent?: ChatTimeline;
  /**
   * Flat tool_result lookup spanning the entire session (root + every
   * sub-agent). TaskToolCard hands this down to its nested
   * ChatTimelineView so inner tool cards can find their own results
   * without re-deriving.
   */
  toolResults?: ToolResultsById;
  /**
   * Forwarded so an interactive AskUserQuestion-style card inside a
   * sub-agent can still post answers back to the chat session. Optional
   * — undefined in static / read-only mounts.
   */
  onAnswerQuestion?: AnswerQuestionHandler;
}

export type ToolRenderer = (props: ToolRendererProps) => ReactNode;

export const toolRegistry = new Map<string, ToolRenderer>();

export function registerToolRenderer(name: string, renderer: ToolRenderer): void {
  toolRegistry.set(name, renderer);
}

export function lookupToolRenderer(name: string): ToolRenderer | null {
  return toolRegistry.get(name) ?? null;
}
