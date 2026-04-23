import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { terminalBusyStore, useTerminalBusy } from './terminalBusy';

const BUSY_ACTIVATE_MS = 2000;  // sustained output for 2s → go gray
const BUSY_DEACTIVATE_MS = 1000; // 1s silence → clear gray

/**
 * Framed WS protocol (see crates/neige-server/src/api/mod.rs handle_ws):
 *   client → server text JSON:
 *     {"type":"attach","last_seq":<number|null>}
 *     {"type":"resize","cols":C,"rows":R}
 *   client → server binary: raw stdin
 *   server → client binary: [u64 BE seq][payload]; seq=0 = reset+write
 *   server → client text JSON: {"type":"hello","last_seq":N}
 */
function readU64BE(bytes: Uint8Array, offset: number): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getBigUint64(0, false);
}

export function useTerminal(containerId: string | null) {
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastSeqRef = useRef<bigint | null>(null);
  const busy = useTerminalBusy(containerId);

  useEffect(() => {
    if (!containerId) return;

    const container = document.getElementById(`terminal-${containerId}`);
    if (!container) return;

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      cursorBlink: true,
      scrollback: 10000,
      macOptionIsMeta: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    container.innerHTML = '';
    term.open(container);

    termRef.current = term;
    fitRef.current = fitAddon;

    // --- Resize strategy ---
    // Single debounced pipeline: container change → fit xterm → send PTY resize.
    // The 150ms debounce prevents flooding the PTY with SIGWINCH during drag resizes.

    let lastCols = 0;
    let lastRows = 0;
    let resizeTimer: ReturnType<typeof setTimeout>;

    const sendResize = (cols: number, rows: number) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        lastCols = cols;
        lastRows = rows;
      }
    };

    const scheduleFit = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
          sendResize(dims.cols, dims.rows);
        }
      }, 150);
    };

    // Batch incoming PTY output per animation frame to avoid
    // cursor jitter during TUI redraws (e.g. Claude Code SIGWINCH)
    let writeBuf: { seq: bigint; bytes: Uint8Array; reset: boolean }[] = [];
    let rafId = 0;

    // Activity tracking:
    // - Go gray: sustained substantial output (500+ bytes/s for 2s)
    // - Clear gray: 1s of silence (fast recovery)
    const BYTES_PER_SECOND_THRESHOLD = 500;
    let bytesInWindow = 0;
    let windowStart = 0;
    let lastOutputTime = 0;
    let idleTimer: ReturnType<typeof setTimeout>;

    const trackOutput = (byteCount: number) => {
      const now = Date.now();

      // Reset window if gap > 1s
      if (now - lastOutputTime > 1000) {
        bytesInWindow = 0;
        windowStart = now;
      }
      lastOutputTime = now;
      bytesInWindow += byteCount;

      // Check if sustained: enough bytes over enough time
      const elapsed = now - windowStart;
      if (elapsed >= BUSY_ACTIVATE_MS && bytesInWindow >= BYTES_PER_SECOND_THRESHOLD * (elapsed / 1000)) {
        terminalBusyStore.set(containerId, true);
      }

      // Fast clear: 1s silence → remove overlay
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        terminalBusyStore.set(containerId, false);
        bytesInWindow = 0;
      }, BUSY_DEACTIVATE_MS);
    };

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
        if (!rafId) {
          rafId = requestAnimationFrame(flush);
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, reconnect happens there
      };

      ws.onclose = (ev) => {
        // Code 1000 = normal close, 1005 = no status (browser cleanup)
        // Don't reconnect for clean closures or if we're cleaning up
        if (disposed || ev.code === 1000) {
          term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
          return;
        }
        scheduleReconnect();
      };

      ws.onopen = () => {
        reconnectAttempts = 0;
        // Attach handshake — tells the server how much of the stream we
        // already have so it can delta-replay instead of dumping full
        // history (and duplicating what's already in our xterm buffer).
        const ls = lastSeqRef.current;
        ws.send(
          JSON.stringify({
            type: 'attach',
            last_seq: ls === null ? null : Number(ls),
          }),
        );
        // Push dimensions so the PTY matches what we render.
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          sendResize(dims.cols, dims.rows);
        }
      };
    };

    // WebSocket connection with reconnect
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/${containerId}`;
    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    const MAX_RECONNECT_DELAY = 10000;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      wireWs(ws);
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
      reconnectTimer = setTimeout(() => {
        if (!disposed) connect();
      }, delay);
    };

    connect();

    // Forward keyboard input
    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // In the alt buffer (TUIs like claude), xterm.js's default is to translate
    // wheel events into up/down arrow key sequences. On a Mac trackpad every
    // flick emits a stream of deltas, so claude sees a burst of arrows and
    // scrolls its message view — the user perceives "text jumping up/down"
    // with no real scroll. Swallow the wheel entirely in the alt buffer; the
    // normal buffer (shell scrollback) keeps xterm.js's default behavior.
    term.attachCustomWheelEventHandler(() => {
      return term.buffer.active.type !== 'alternate';
    });

    // Cmd+Left/Right → line start/end (browser swallows these as history nav otherwise)
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

    // Resize observers
    window.addEventListener('resize', scheduleFit);
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);

    // When this tab becomes visible, force a resize push even if our local
    // dimensions haven't changed — another client (e.g. phone) may have
    // shrunk the shared PTY while we were hidden, so claude's output is now
    // laid out for their size. Clearing lastCols/lastRows bypasses the
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
      clearTimeout(resizeTimer);
      clearTimeout(idleTimer);
      clearTimeout(reconnectTimer);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleFit);
      document.removeEventListener('visibilitychange', onVisibility);
      ro.disconnect();
      wsRef.current?.close(1000);
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
      terminalBusyStore.set(containerId, false);
    };
  }, [containerId]);

  return { termRef, wsRef, fitRef, busy };
}
