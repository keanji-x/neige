// Kernel-wire → UI-shape adapters.
//
// The kernel deliberately stores only structural facts (Cove/Wave/Card).
// Status, progress, ETA — everything semantic — comes from plugin
// overlays. Until the plugin host lands (M3), we fall back to sane
// "no plugin" defaults so the UI still has something to render.

import type {
  Cove,
  TerminalCardData,
  Wave,
  WaveCardData,
  WaveStatus,
} from '../types';
import type {
  KernelCard,
  KernelCove,
  KernelOverlay,
  KernelWave,
} from './wire';

/**
 * Adapt a kernel Cove to the UI shape.
 *
 * The mockup carried a `subtitle` ("Personal site", "Client · e-commerce"),
 * which the kernel does not store. Rather than adding a column for it, we
 * leave the field present but blank — the page can derive a secondary
 * (wave count, running count) when it wants something in the eyebrow.
 */
export function adaptCove(k: KernelCove): Cove {
  return { id: k.id, name: k.name, subtitle: '', color: k.color };
}

/**
 * Derive a small text summary suitable for a cove's secondary line, e.g.
 * `"3 waves · 1 running"`. Returns an empty string for an empty cove so
 * the renderer can drop the line entirely.
 */
export function coveSummary(waves: Wave[]): string {
  if (waves.length === 0) return '';
  const running = waves.filter((w) => w.status === 'running').length;
  const noun = waves.length === 1 ? 'wave' : 'waves';
  if (running === 0) return `${waves.length} ${noun}`;
  return `${waves.length} ${noun} · ${running} running`;
}

/**
 * Folds the wave's own overlays into the UI shape. Recognized overlay kinds:
 *   - `"status"`   payload: `{ state: "running" | "waiting" }`
 *   - `"progress"` payload: `{ value: number }`  (0..1)
 *   - `"eta"`      payload: `{ text: string }`
 *   - `"now"`      payload: `{ text: string }`
 *
 * Anything else is ignored. Multiple plugins setting the same kind is
 * last-write-wins by overlay order — once a real plugin model exists we'll
 * pick by `plugin_id` priority.
 */
export function adaptWave(k: KernelWave, overlays: KernelOverlay[] = []): Wave {
  // Defaults: idle, no progress, no eta/now text. The UI hides empty
  // strings rather than rendering placeholder dashes, so a wave with no
  // overlays reads as a quiet structural row, not a half-broken status pill.
  let status: WaveStatus = 'idle';
  let progress = 0;
  let eta = '';
  let now = '';

  for (const o of overlays) {
    if (o.entity_kind !== 'wave' || o.entity_id !== k.id) continue;
    const p = o.payload as Record<string, unknown> | null;
    if (!p) continue;
    if (o.kind === 'status' && typeof p.state === 'string') {
      // Only the recognized states map back to the UI enum; anything else
      // leaves the wave idle (forward-compatible with future plugin states).
      if (p.state === 'running') status = 'running';
      else if (p.state === 'waiting') status = 'waiting';
    } else if (o.kind === 'progress' && typeof p.value === 'number') {
      progress = p.value;
    } else if (o.kind === 'eta' && typeof p.text === 'string') {
      eta = p.text;
    } else if (o.kind === 'now' && typeof p.text === 'string') {
      now = p.text;
    }
  }

  return {
    id: k.id,
    coveId: k.cove_id,
    title: k.title,
    status,
    progress,
    eta,
    now,
  };
}

/**
 * Map a kernel Card to one of the UI's card variants. Returns `null` for
 * unrecognized kinds (e.g. `plugin:foo:bar` before the plugin host renders
 * iframe views) so the caller can skip the row entirely.
 *
 * For `terminal` cards the kernel stores `{ terminal_id }` in `payload`
 * (the UI writes this on creation). When the field is absent the card
 * still renders, just without a live PTY — useful while a terminal is
 * being provisioned.
 */
export function adaptCard(k: KernelCard): WaveCardData | null {
  if (k.kind === 'terminal') {
    const payload =
      typeof k.payload === 'object' && k.payload !== null
        ? (k.payload as { terminal_id?: string })
        : null;
    const card: TerminalCardData = {
      type: 'terminal',
      title: 'terminal',
      lines: [],
      terminalId: payload?.terminal_id,
    };
    return card;
  }
  // Plugin-provided cards (kind = "plugin:<id>:<view>") are rendered via
  // iframe proxy in M3 — for now they're skipped.
  return null;
}
