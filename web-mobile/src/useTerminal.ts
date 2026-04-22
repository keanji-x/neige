import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { cardActivity } from './cardActivity'

/**
 * Mobile-tuned terminal hook. Mirrors the desktop WS/resize protocol and also
 * exposes the live `Terminal` instance via `termRef` so peripheral UI (scroll
 * edge, jump-to-bottom FAB, overview thumbnail) can read/drive the viewport
 * without owning the xterm itself.
 */
export interface UseTerminalApi {
  sendText: (s: string) => void
  sendKey: (s: string) => void
  status: 'connecting' | 'open' | 'closed' | 'reconnecting'
  busy: boolean
  termRef: RefObject<Terminal | null>
}

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  sessionId: string | null,
): UseTerminalApi {
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<UseTerminalApi['status']>('connecting')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
      fontSize: 13,
      fontFamily:
        "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
      cursorBlink: true,
      scrollback: 10000,
      macOptionIsMeta: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    container.innerHTML = ''
    term.open(container)
    termRef.current = term
    fitRef.current = fit

    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout>

    const sendResize = (cols: number, rows: number) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
        ws.send('\x1b[RESIZE]' + JSON.stringify({ cols, rows }))
        lastCols = cols
        lastRows = rows
      }
    }

    const scheduleFit = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const rect = container.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        fit.fit()
        const dims = fit.proposeDimensions()
        if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
          sendResize(dims.cols, dims.rows)
        }
      }, 150)
    }

    const BYTES_THRESHOLD = 500
    const ACTIVATE_MS = 2000
    const DEACTIVATE_MS = 1000
    let bytesInWindow = 0
    let windowStart = 0
    let lastOutputTime = 0
    let idleTimer: ReturnType<typeof setTimeout>

    const trackOutput = (n: number) => {
      // Share raw output events with the cross-card activity store; that's
      // what drives the per-card "unread" counter in the Overview.
      cardActivity.onOutput(sessionId)

      const now = Date.now()
      if (now - lastOutputTime > 1000) {
        bytesInWindow = 0
        windowStart = now
      }
      lastOutputTime = now
      bytesInWindow += n
      const elapsed = now - windowStart
      if (elapsed >= ACTIVATE_MS && bytesInWindow >= BYTES_THRESHOLD * (elapsed / 1000)) {
        setBusy(true)
      }
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        setBusy(false)
        bytesInWindow = 0
      }, DEACTIVATE_MS)
    }

    let writeBuf: Uint8Array[] = []
    let rafId = 0

    const wireWs = (ws: WebSocket) => {
      ws.onmessage = (e) => {
        let chunk: Uint8Array
        if (e.data instanceof ArrayBuffer) {
          chunk = new Uint8Array(e.data)
        } else {
          chunk = new TextEncoder().encode(e.data)
        }
        writeBuf.push(chunk)
        trackOutput(chunk.byteLength)
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            const chunks = writeBuf
            writeBuf = []
            rafId = 0
            for (const c of chunks) term.write(c)
          })
        }
      }
      ws.onopen = () => {
        reconnectAttempts = 0
        setStatus('open')
        fit.fit()
        const dims = fit.proposeDimensions()
        if (dims) {
          sendResize(dims.cols, dims.rows)
          // Cold-join nudge: many TUIs (Claude Code, less, vim) only redraw on
          // SIGWINCH. A second resize 300ms later forces a repaint so newly
          // attached clients don't stare at a blank screen until the next tick.
          setTimeout(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              // Perturb by 1 col so the server sees a distinct value, then
              // restore — that makes the SIGWINCH real, not a no-op.
              sendResize(Math.max(2, dims.cols - 1), dims.rows)
              setTimeout(() => sendResize(dims.cols, dims.rows), 80)
            }
          }, 300)
        }
      }
      ws.onclose = (ev) => {
        if (disposed || ev.code === 1000) {
          setStatus('closed')
          term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
          return
        }
        setStatus('reconnecting')
        term.write('\r\n\x1b[33m[connection lost — reconnecting...]\x1b[0m\r\n')
        scheduleReconnect()
      }
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${location.host}/ws/${sessionId}`
    let disposed = false
    let reconnectAttempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      setStatus('connecting')
      wireWs(ws)
    }

    const scheduleReconnect = () => {
      if (disposed) return
      reconnectAttempts++
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 10000)
      reconnectTimer = setTimeout(() => {
        if (!disposed) connect()
      }, delay)
    }

    connect()

    term.onData((data) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
    })

    window.addEventListener('resize', scheduleFit)
    const ro = new ResizeObserver(scheduleFit)
    ro.observe(container)

    const vv = window.visualViewport
    if (vv) vv.addEventListener('resize', scheduleFit)

    return () => {
      disposed = true
      clearTimeout(resizeTimer)
      clearTimeout(idleTimer)
      clearTimeout(reconnectTimer)
      if (rafId) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', scheduleFit)
      if (vv) vv.removeEventListener('resize', scheduleFit)
      ro.disconnect()
      wsRef.current?.close(1000)
      term.dispose()
      termRef.current = null
      wsRef.current = null
      fitRef.current = null
    }
  }, [sessionId, containerRef])

  const sendText = (s: string) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(s)
  }
  const sendKey = sendText

  return { sendText, sendKey, status, busy, termRef }
}
