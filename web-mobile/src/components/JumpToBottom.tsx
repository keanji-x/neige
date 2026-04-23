import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'

interface Props {
  termRef: RefObject<Terminal | null>
}

/**
 * Shown only when the viewport is above the live tail — tap to jump back.
 * Uses xterm's onScroll; the button is suppressed when the user is already at
 * the bottom so it doesn't clutter the normal reading surface.
 */
export function JumpToBottom({ termRef }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const term = termRef.current
    if (!term) return

    const update = () => {
      const b = term.buffer.active
      const atBottom = b.viewportY >= b.baseY
      setVisible(!atBottom)
    }

    update()
    const dispScroll = term.onScroll(update)
    const dispWrite = term.onWriteParsed(update)

    return () => {
      dispScroll.dispose()
      dispWrite.dispose()
    }
  }, [termRef])

  if (!visible) return null

  return (
    <button
      className="jump-bottom"
      onClick={() => termRef.current?.scrollToBottom()}
      aria-label="jump to bottom"
    >
      ↓
    </button>
  )
}
