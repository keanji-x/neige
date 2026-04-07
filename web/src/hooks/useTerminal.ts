import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export function useTerminal(containerId: string | null) {
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

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
    // Two separate debounces:
    //   1. Visual fit (fast, 100ms) — makes the terminal look correct quickly
    //   2. PTY resize (slow, 500ms) — avoids flooding Claude TUI with SIGWINCH
    //
    // During the gap between fit and PTY resize, we suppress onResize from
    // sending to the server. Only the PTY resize timer sends the final size.

    let lastCols = 0;
    let lastRows = 0;
    let suppressResizeEvent = false;

    let fitTimer: ReturnType<typeof setTimeout>;
    let ptyResizeTimer: ReturnType<typeof setTimeout>;

    const sendResize = (cols: number, rows: number) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
        ws.send('\x1b[RESIZE]' + JSON.stringify({ cols, rows }));
        lastCols = cols;
        lastRows = rows;
      }
    };

    const scheduleFit = () => {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // Suppress onResize from triggering PTY resize during this fit
        suppressResizeEvent = true;
        fitAddon.fit();
        suppressResizeEvent = false;

        // Schedule the actual PTY resize after things settle
        clearTimeout(ptyResizeTimer);
        ptyResizeTimer = setTimeout(() => {
          const dims = fitAddon.proposeDimensions();
          if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
            sendResize(dims.cols, dims.rows);
          }
        }, 50);
      }, 100);
    };

    // onResize: only forward to PTY if not triggered by our own fit()
    term.onResize(({ cols, rows }) => {
      if (!suppressResizeEvent && (cols !== lastCols || rows !== lastRows)) {
        clearTimeout(ptyResizeTimer);
        ptyResizeTimer = setTimeout(() => sendResize(cols, rows), 50);
      }
    });

    // WebSocket connection
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/${containerId}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    // Batch incoming PTY output per animation frame to avoid
    // cursor jitter during TUI redraws (e.g. Claude Code SIGWINCH)
    let writeBuf: Uint8Array[] = [];
    let rafId = 0;

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        writeBuf.push(new Uint8Array(e.data));
      } else {
        writeBuf.push(new TextEncoder().encode(e.data));
      }
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          const chunks = writeBuf;
          writeBuf = [];
          rafId = 0;
          for (const chunk of chunks) {
            term.write(chunk);
          }
        });
      }
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
    };

    ws.onopen = () => {
      // Initial fit + resize
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        sendResize(dims.cols, dims.rows);
      }
    };

    // Forward keyboard input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize observers
    window.addEventListener('resize', scheduleFit);
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);

    return () => {
      clearTimeout(fitTimer);
      clearTimeout(ptyResizeTimer);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleFit);
      ro.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [containerId]);

  return { termRef, wsRef, fitRef };
}
