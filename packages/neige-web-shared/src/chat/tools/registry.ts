// Pluggable renderer registry for tool_use blocks. Lookup is exact-match on
// the tool name; miss returns null so callers can fall back to DefaultToolCard.

import type { ReactNode } from 'react';
import type { ToolResultContent } from '../types';

export interface ToolRendererProps {
  name: string;
  input: unknown;
  isStreaming: boolean;
  result?: { content: ToolResultContent; isError: boolean };
  respond: (text: string) => void;
}

export type ToolRenderer = (props: ToolRendererProps) => ReactNode;

export const toolRegistry = new Map<string, ToolRenderer>();

export function registerToolRenderer(name: string, renderer: ToolRenderer): void {
  toolRegistry.set(name, renderer);
}

export function lookupToolRenderer(name: string): ToolRenderer | null {
  return toolRegistry.get(name) ?? null;
}
