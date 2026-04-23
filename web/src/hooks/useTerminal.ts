import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useTerminalCore } from '@neige/shared';
import { terminalBusyStore, useTerminalBusy } from './terminalBusy';

/**
 * Desktop-flavoured terminal hook. Thin wrapper over `useTerminalCore` that
 * layers on:
 *   - desktop theme + JetBrains-style mono font
 *   - Cmd+Arrow / Cmd+Backspace shortcuts so macOS doesn't eat them as
 *     history navigation
 *   - publishes busy state into the global `terminalBusyStore` so the
 *     sidebar badge + per-tab overlay can subscribe without prop drilling
 */
export function useTerminal(containerId: string | null) {
  // The existing desktop markup uses `id={terminal-<convId>}` instead of
  // passing a ref around — build a synthetic ref that looks the element up
  // by id so the shared core (which expects a ref) keeps working without
  // touching TerminalPanel.tsx.
  const containerRef = useMemo<RefObject<HTMLDivElement | null>>(() => {
    return {
      get current() {
        if (!containerId) return null;
        return document.getElementById(
          `terminal-${containerId}`,
        ) as HTMLDivElement | null;
      },
      set current(_v) {
        // no-op — this ref is read-only by design
      },
    } as RefObject<HTMLDivElement | null>;
  }, [containerId]);

  const theme = useMemo(
    () => ({
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
    }),
    [],
  );

  const sessionIdRef = useRef<string | null>(containerId);
  sessionIdRef.current = containerId;

  const { termRef, wsRef, fitRef } = useTerminalCore({
    containerRef,
    sessionId: containerId,
    theme,
    fontSize: 14,
    fontFamily:
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    onBusyChange: (busy) => {
      const id = sessionIdRef.current;
      if (id) terminalBusyStore.set(id, busy);
    },
    onTerminalReady: (term) => {
      // Cmd+Left/Right → line start/end, Cmd+Backspace → kill line. The
      // browser swallows these by default (history nav), so intercept and
      // forward the equivalent control codes to the PTY.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        if (!e.metaKey || e.ctrlKey || e.altKey) return true;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return true;
        if (e.key === 'ArrowLeft') {
          ws.send('\x01');
          e.preventDefault();
          return false;
        }
        if (e.key === 'ArrowRight') {
          ws.send('\x05');
          e.preventDefault();
          return false;
        }
        if (e.key === 'Backspace') {
          ws.send('\x15');
          e.preventDefault();
          return false;
        }
        return true;
      });
    },
  });

  // Clear any lingering busy state for this id when we dispose. The core
  // fires onBusyChange(false) on teardown, but only if we were busy at the
  // time — explicit clear is cheap insurance.
  useEffect(() => {
    const id = containerId;
    return () => {
      if (id) terminalBusyStore.set(id, false);
    };
  }, [containerId]);

  const busy = useTerminalBusy(containerId);

  return { termRef, wsRef, fitRef, busy };
}
