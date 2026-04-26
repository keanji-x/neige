// Pluggable renderer registry for NeigeEvent::Passthrough events. Lookup is
// exact-match first, then walks back through dot-segmented prefixes ending in
// '.', so a registration on 'hook.' handles every 'hook.<subtype>' kind.

import type { ReactNode } from 'react';

export interface PassthroughRendererProps {
  kind: string;
  payload: unknown;
  /**
   * Resolve a `neige.ask_user_question` dialog by sending an
   * `answer_question` WS frame. Optional — only the chat WS-driven mount
   * supplies it; static / preview mounts pass undefined and the renderer
   * should fall back to a read-only display.
   */
  answerQuestion?: (questionId: string, answer: string) => void;
}

export type PassthroughRenderer = (props: PassthroughRendererProps) => ReactNode;

export const passthroughRegistry = new Map<string, PassthroughRenderer>();

export function registerPassthroughRenderer(
  key: string,
  renderer: PassthroughRenderer,
): void {
  passthroughRegistry.set(key, renderer);
}

export function lookupRenderer(kind: string): PassthroughRenderer | null {
  const exact = passthroughRegistry.get(kind);
  if (exact) return exact;

  // Walk back through dot-prefixes: 'hook.pre_tool_use' -> 'hook.'
  let cursor = kind.length;
  while (cursor > 0) {
    const dot = kind.lastIndexOf('.', cursor - 1);
    if (dot < 0) break;
    const prefix = kind.slice(0, dot + 1);
    const hit = passthroughRegistry.get(prefix);
    if (hit) return hit;
    cursor = dot;
  }
  return null;
}
