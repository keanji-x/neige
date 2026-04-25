// Pluggable renderer registry for NeigeEvent::Passthrough events. Lookup is
// exact-match first, then walks back through dot-segmented prefixes ending in
// '.', so a registration on 'hook.' handles every 'hook.<subtype>' kind.

import type { ReactNode } from 'react';

export type PassthroughRenderer = (props: {
  kind: string;
  payload: unknown;
}) => ReactNode;

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
