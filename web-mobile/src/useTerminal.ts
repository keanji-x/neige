import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { cardActivity } from './cardActivity'

/**
 * Mobile-tuned terminal hook. The xterm instance lives for the whole lifetime
 * of the hook; the WebSocket comes and goes underneath it — network blips,
 * laptop sleep, or 30-second tunnel idle timeouts cost us nothing but a quick
 * delta replay on reconnect.
 *
 * Wire protocol (see crates/neige-server/src/api/mod.rs `handle_ws`):
 *   Client → server (text JSON):
 *     {"type":"attach","last_seq":<number|null>}   // first frame
 *     {"type":"resize","cols":C,"rows":R}
 *   Client → server (binary): raw stdin.
 *   Server → client (binary): [u64 BE seq][payload]. seq=0 = "reset+write".
 *   Server → client (text JSON): {"type":"hello","last_seq":N} after the
 *     initial prime, so the client knows its new baseline.
 */
export interface UseTerminalApi {
  sendText: (s: string) => void
  sendKey: (s: string) => void
  status: 'connecting' | 'open' | 'closed' | 'reconnecting'
  busy: boolean
  termRef: RefObject<Terminal | null>
}

function readU64BE(bytes: Uint8Array, offset: number): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  return view.getBigUint64(0, false)
}

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  sessionId: string | null,
): UseTerminalApi {
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const lastSeqRef = useRef<bigint | null>(null)
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
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
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

    let writeBuf: { seq: bigint; bytes: Uint8Array; reset: boolean }[] = []
    let rafId = 0

    const flush = () => {
      rafId = 0
      const chunks = writeBuf
      writeBuf = []
      for (const c of chunks) {
        if (c.reset) term.reset()
        term.write(c.bytes)
        // Only real chunks advance the baseline; snapshots update via "hello".
        if (!c.reset && c.seq > 0n) lastSeqRef.current = c.seq
      }
    }

    const wireWs = (ws: WebSocket) => {
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          try {
            const msg = JSON.parse(e.data)
            if (msg && msg.type === 'hello' && typeof msg.last_seq === 'number') {
              lastSeqRef.current = BigInt(msg.last_seq)
            }
          } catch {
            // ignore bad JSON
          }
          return
        }
        if (!(e.data instanceof ArrayBuffer) || e.data.byteLength < 8) return
        const buf = new Uint8Array(e.data)
        const seq = readU64BE(buf, 0)
        const payload = buf.subarray(8)
        writeBuf.push({ seq, bytes: payload, reset: seq === 0n })
        trackOutput(payload.byteLength)
        if (!rafId) rafId = requestAnimationFrame(flush)
      }
      ws.onopen = () => {
        reconnectAttempts = 0
        setStatus('open')
        // Attach handshake: tells the server which chunks we already have.
        // A null last_seq means "fresh" and the server will send a full
        // snapshot.
        const ls = lastSeqRef.current
        ws.send(
          JSON.stringify({
            type: 'attach',
            last_seq: ls === null ? null : Number(ls),
          }),
        )
        // Fit & push current dimensions so the PTY matches what we render.
        fit.fit()
        const dims = fit.proposeDimensions()
        if (dims) sendResize(dims.cols, dims.rows)
      }
      ws.onclose = (ev) => {
        if (disposed || ev.code === 1000) {
          setStatus('closed')
          term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
          return
        }
        setStatus('reconnecting')
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
