import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'

interface Props {
  termRef: RefObject<Terminal | null>
}

/**
 * A narrow drag-to-scroll strip on the right edge of the terminal pane. Works
 * like a scrollbar but you can start a drag from anywhere on the strip; pixel
 * delta maps to line delta (SCROLL_RATIO lines per pixel). Tap at top/bottom
 * 15% jumps to buffer start/end for fast "scroll to oldest" / "scroll to live".
 */
const SCROLL_RATIO = 0.5

export function ScrollEdge({ termRef }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let startY = 0
    let startLine = 0
    let dragging = false
    let moved = false

    const onStart = (e: TouchEvent) => {
      const term = termRef.current
      if (!term || e.touches.length !== 1) return
      dragging = true
      moved = false
      startY = e.touches[0].clientY
      startLine = term.buffer.active.viewportY
      setActive(true)
      e.preventDefault()
    }

    const onMove = (e: TouchEvent) => {
      if (!dragging) return
      const term = termRef.current
      if (!term) return
      const dy = e.touches[0].clientY - startY
      if (Math.abs(dy) > 4) moved = true
      const targetLine = Math.round(startLine + dy * SCROLL_RATIO)
      const baseY = term.buffer.active.baseY
      const clamped = Math.max(0, Math.min(targetLine, baseY))
      const delta = clamped - term.buffer.active.viewportY
      if (delta !== 0) term.scrollLines(delta)
      e.preventDefault()
    }

    const onEnd = (e: TouchEvent) => {
      if (!dragging) return
      dragging = false
      setActive(false)
      if (moved) {
        e.preventDefault()
        return
      }
      // Tap: jump to top/bottom if near edges
      const term = termRef.current
      if (!term) return
      const rect = el.getBoundingClientRect()
      const touch = e.changedTouches[0]
      const frac = (touch.clientY - rect.top) / rect.height
      if (frac < 0.15) {
        term.scrollToTop()
      } else if (frac > 0.85) {
        term.scrollToBottom()
      }
    }

    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: false })
    el.addEventListener('touchcancel', onEnd, { passive: false })

    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [termRef])

  return <div ref={ref} className={`scroll-edge${active ? ' scroll-edge-active' : ''}`} />
}
