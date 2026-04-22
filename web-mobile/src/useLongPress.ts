import { useRef } from 'react'

/**
 * Fires `onLongPress` when the user holds a touch for `delay` ms without
 * meaningfully moving their finger. Returns touch handlers to spread on the
 * target element. Movement > MOVE_THRESHOLD px cancels the press (so scrolling
 * past a card doesn't accidentally trigger the menu).
 */
const MOVE_THRESHOLD = 8

export function useLongPress(onLongPress: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)

  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      startRef.current = { x: t.clientX, y: t.clientY }
      firedRef.current = false
      clear()
      timerRef.current = setTimeout(() => {
        firedRef.current = true
        if ('vibrate' in navigator) navigator.vibrate?.(12)
        onLongPress()
      }, delay)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = startRef.current
      if (!s) return
      const t = e.touches[0]
      const dx = Math.abs(t.clientX - s.x)
      const dy = Math.abs(t.clientY - s.y)
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) clear()
    },
    onTouchEnd: (_e: React.TouchEvent) => {
      clear()
    },
    onTouchCancel: (_e: React.TouchEvent) => {
      clear()
    },
    onContextMenu: (e: React.MouseEvent) => {
      // Browser's native long-press context menu would steal the gesture.
      e.preventDefault()
    },
    didFire: () => firedRef.current,
  }
}
