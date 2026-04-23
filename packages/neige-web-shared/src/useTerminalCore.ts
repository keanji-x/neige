import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme, ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

/**
 * Shared WS framing contract (see crates/neige-server/src/api/mod.rs handle_ws):
 *   Client → server text JSON:
 *     {"type":"attach","last_seq":<number|null>}   // first frame
 *     {"type":"resize","cols":C,"rows":R}
 *   Client → server binary: raw stdin.
 *   Server → client binary: [u64 BE seq][payload]. seq=0 = "reset+write".
 *   Server → client text JSON: {"type":"hello","last_seq":N} after initial
 *     prime, so the client knows its new baseline.
 */
function readU64BE(bytes: Uint8Array, offset: number): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getBigUint64(0, false);
}

export type TerminalStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface UseTerminalCoreOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  sessionId: string | null;
  theme?: ITheme;
  fontFamily?: string;
  fontSize?: number;
  scrollback?: number;
  /** Fires on every PTY output chunk, with the sessionId + payload byte count. */
  onActivity?: (sessionId: string, byteCount: number) => void;
  /** Called when sustained-output busy state flips. */
  onBusyChange?: (busy: boolean) => void;
  /** WebSocket lifecycle status. */
  onStatusChange?: (status: TerminalStatus) => void;
  /** Called once the xterm Terminal is ready (after open()). */
  onTerminalReady?: (term: Terminal) => void;
  /** Extra xterm options merged on top of the defaults. */
  xtermOptions?: Partial<ITerminalOptions>;
}

export interface UseTerminalCoreApi {
  termRef: RefObject<Terminal | null>;
  fitRef: RefObject<FitAddon | null>;
  wsRef: RefObject<WebSocket | null>;
  sendData: (s: string | Uint8Array) => void;
  sendResize: (cols: number, rows: number) => void;
  /**
   * Re-runs the debounced fit pipeline — call this when something external
   * (e.g. mobile visualViewport resize) changed the visible layout without
   * the container's ResizeObserver firing.
   */
  scheduleFit: () => void;
}

const BUSY_ACTIVATE_MS = 2000; // sustained output for 2s → busy
const BUSY_DEACTIVATE_MS = 1000; // 1s of silence → clear busy
const BYTES_PER_SECOND_THRESHOLD = 500;
const MAX_RECONNECT_DELAY = 10000;

/**
 * Creates an xterm Terminal bound to a ref, connects it to `/ws/<sessionId>`
 * with the framed attach protocol, and manages reconnect + resize + activity
 * tracking. Each frontend wraps this to layer on its own concerns (theme,
 * busy store, keyboard shortcuts, viewport quirks).
 */
export function useTerminalCore(opts: UseTerminalCoreOptions): UseTerminalCoreApi {
  const {
    containerRef,
    sessionId,
    theme,
    fontFamily,
    fontSize,
    scrollback = 10000,
    onActivity,
    onBusyChange,
    onStatusChange,
    onTerminalReady,
    xtermOptions,
  } = opts;

  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastSeqRef = useRef<bigint | null>(null);
  const scheduleFitRef = useRef<() => void>(() => {});

  // Keep callbacks fresh across renders without retriggering the whole
  // connect/teardown effect on every function identity change.
  const onActivityRef = useRef(onActivity);
  const onBusyChangeRef = useRef(onBusyChange);
  const onStatusChangeRef = useRef(onStatusChange);
  const onTerminalReadyRef = useRef(onTerminalReady);
  useEffect(() => {
    onActivityRef.current = onActivity;
    onBusyChangeRef.current = onBusyChange;
    onStatusChangeRef.current = onStatusChange;
    onTerminalReadyRef.current = onTerminalReady;
  }, [onActivity, onBusyChange, onStatusChange, onTerminalReady]);

  useEffect(() => {
    if (!sessionId) return;
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme,
      fontFamily,
      fontSize,
      cursorBlink: true,
      scrollback,
      macOptionIsMeta: true,
      ...xtermOptions,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    container.innerHTML = '';
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    onTerminalReadyRef.current?.(term);

    // --- Resize pipeline ---
    // Single debounced chain: container change → fit xterm → send PTY resize.
    // 150ms debounce keeps SIGWINCH from flooding the PTY during drag resizes.
    let lastCols = 0;
    let lastRows = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    const sendResize = (cols: number, rows: number) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        lastCols = cols;
        lastRows = rows;
      }
    };

    const scheduleFit = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
          sendResize(dims.cols, dims.rows);
        }
      }, 150);
    };
    scheduleFitRef.current = scheduleFit;

    // --- Activity / busy tracking ---
    // Go busy: sustained substantial output (500+ bytes/s for 2s).
    // Clear busy: 1s of silence (fast recovery).
    let bytesInWindow = 0;
    let windowStart = 0;
    let lastOutputTime = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let currentBusy = false;

    const setBusy = (busy: boolean) => {
      if (busy === currentBusy) return;
      currentBusy = busy;
      onBusyChangeRef.current?.(busy);
    };

    const trackOutput = (byteCount: number) => {
      onActivityRef.current?.(sessionId, byteCount);
      const now = Date.now();
      if (now - lastOutputTime > 1000) {
        bytesInWindow = 0;
        windowStart = now;
      }
      lastOutputTime = now;
      bytesInWindow += byteCount;
      const elapsed = now - windowStart;
      if (
        elapsed >= BUSY_ACTIVATE_MS &&
        bytesInWindow >= BYTES_PER_SECOND_THRESHOLD * (elapsed / 1000)
      ) {
        setBusy(true);
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setBusy(false);
        bytesInWindow = 0;
      }, BUSY_DEACTIVATE_MS);
    };

    // Batch incoming PTY output per animation frame to avoid cursor jitter
    // during TUI redraws (e.g. Claude Code SIGWINCH).
    let writeBuf: { seq: bigint; bytes: Uint8Array; reset: boolean }[] = [];
    let rafId = 0;

    const flush = () => {
      rafId = 0;
      const chunks = writeBuf;
      writeBuf = [];
      for (const c of chunks) {
        if (c.reset) term.reset();
        term.write(c.bytes);
        if (!c.reset && c.seq > 0n) lastSeqRef.current = c.seq;
      }
    };

    const wireWs = (ws: WebSocket) => {
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          try {
            const msg = JSON.parse(e.data);
            if (msg && msg.type === 'hello' && typeof msg.last_seq === 'number') {
              lastSeqRef.current = BigInt(msg.last_seq);
            }
          } catch {
            // ignore bad JSON
          }
          return;
        }
        if (!(e.data instanceof ArrayBuffer) || e.data.byteLength < 8) return;
        const buf = new Uint8Array(e.data);
        const seq = readU64BE(buf, 0);
        const payload = buf.subarray(8);
        writeBuf.push({ seq, bytes: payload, reset: seq === 0n });
        trackOutput(payload.byteLength);
        if (!rafId) rafId = requestAnimationFrame(flush);
      };

      ws.onerror = () => {
        // onerror is always followed by onclose; reconnect happens there.
      };

      ws.onopen = () => {
        reconnectAttempts = 0;
        onStatusChangeRef.current?.('open');
        // Attach handshake — tells the server which chunks we already have
        // so it can delta-replay instead of dumping full history.
        const ls = lastSeqRef.current;
        ws.send(
          JSON.stringify({
            type: 'attach',
            last_seq: ls === null ? null : Number(ls),
          }),
        );
        // Push dimensions so the PTY matches what we render.
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims) sendResize(dims.cols, dims.rows);
      };

      ws.onclose = (ev) => {
        if (disposed || ev.code === 1000) {
          onStatusChangeRef.current?.('closed');
          term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
          return;
        }
        onStatusChangeRef.current?.('reconnecting');
        scheduleReconnect();
      };
    };

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/${sessionId}`;
    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      onStatusChangeRef.current?.('connecting');
      wireWs(ws);
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      reconnectAttempts++;
      const delay = Math.min(
        1000 * Math.pow(1.5, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY,
      );
      reconnectTimer = setTimeout(() => {
        if (!disposed) connect();
      }, delay);
    };

    connect();

    // Forward keyboard input to the PTY.
    const dataDisposable = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    window.addEventListener('resize', scheduleFit);
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);

    // When this tab becomes visible, force a resize push even if our local
    // dimensions haven't changed — another client (e.g. phone) may have
    // shrunk the shared PTY while we were hidden, so the TUI's output is
    // now laid out for their size. Clearing lastCols/lastRows bypasses the
    // "no-op if unchanged" short-circuit in scheduleFit.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      lastCols = 0;
      lastRows = 0;
      scheduleFit();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleFit);
      document.removeEventListener('visibilitychange', onVisibility);
      ro.disconnect();
      dataDisposable.dispose();
      wsRef.current?.close(1000);
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
      scheduleFitRef.current = () => {};
      // Let the caller clear any external busy state on teardown.
      if (currentBusy) onBusyChangeRef.current?.(false);
    };
  }, [
    sessionId,
    containerRef,
    theme,
    fontFamily,
    fontSize,
    scrollback,
    xtermOptions,
  ]);

  const sendData = useCallback((s: string | Uint8Array) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // WebSocket.send accepts string | Blob | BufferSource; the Uint8Array
    // branch needs an explicit cast because TS widens to ArrayBufferLike.
    if (typeof s === 'string') ws.send(s);
    else ws.send(s as unknown as ArrayBuffer);
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  const scheduleFit = useCallback(() => {
    scheduleFitRef.current();
  }, []);

  return { termRef, fitRef, wsRef, sendData, sendResize, scheduleFit };
}
