import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const BUSY_ACTIVATE_MS = 2000;  // sustained output for 2s → go gray
const BUSY_DEACTIVATE_MS = 1000; // 1s silence → clear gray

export function useTerminal(containerId: string | null) {
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [busy, setBusy] = useState(false);

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
        ws.send('\x1b[RESIZE]' + JSON.stringify({ cols, rows }));
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
    let writeBuf: Uint8Array[] = [];
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
        setBusy(true);
      }

      // Fast clear: 1s silence → remove overlay
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setBusy(false);
        bytesInWindow = 0;
      }, BUSY_DEACTIVATE_MS);
    };

    const wireWs = (ws: WebSocket) => {
      ws.onmessage = (e) => {
        let chunk: Uint8Array;
        if (e.data instanceof ArrayBuffer) {
          chunk = new Uint8Array(e.data);
        } else {
          chunk = new TextEncoder().encode(e.data);
        }
        writeBuf.push(chunk);
        trackOutput(chunk.byteLength);
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            const chunks = writeBuf;
            writeBuf = [];
            rafId = 0;
            for (const c of chunks) {
              term.write(c);
            }
          });
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
        term.write('\r\n\x1b[33m[connection lost — reconnecting...]\x1b[0m\r\n');
        scheduleReconnect();
      };

      ws.onopen = () => {
        reconnectAttempts = 0;
        // Initial fit + resize
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
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize observers
    window.addEventListener('resize', scheduleFit);
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      clearTimeout(idleTimer);
      clearTimeout(reconnectTimer);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleFit);
      ro.disconnect();
      wsRef.current?.close(1000);
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [containerId]);

  return { termRef, wsRef, fitRef, busy };
}
