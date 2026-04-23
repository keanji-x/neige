interface Props {
  onKey: (seq: string) => void
}

interface KeyDef {
  label: string
  seq: string
  variant?: 'macro' | 'wide'
}

// Claude-friendly shortcuts, not a generic terminal key bar.
// Numbers 1/2/3 cover Claude's menu choices; Esc interrupts; ↑↓ history.
// Macros (/rewind, ⌃C) are one-tap; everything else is raw key passthrough.
const KEYS: KeyDef[] = [
  { label: 'Esc', seq: '\x1b' },
  { label: '⌃C', seq: '\x03' },
  { label: '/rewind', seq: '/rewind\r', variant: 'macro' },
  { label: '1', seq: '1' },
  { label: '2', seq: '2' },
  { label: '3', seq: '3' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  { label: 'Tab', seq: '\t' },
  { label: '⌫', seq: '\x7f' },
  { label: '/', seq: '/' },
  { label: '⏎', seq: '\r', variant: 'wide' },
]

export function KeyBar({ onKey }: Props) {
  const tap = (seq: string) => {
    onKey(seq)
    if ('vibrate' in navigator) navigator.vibrate?.(8)
  }
  return (
    <div className="key-bar" role="toolbar" aria-label="shortcuts">
      {KEYS.map((k) => {
        const variantClass =
          k.variant === 'wide' ? ' key-wide' : k.variant === 'macro' ? ' key-macro' : ''
        return (
          <button
            key={k.label}
            className={`key-btn${variantClass}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => tap(k.seq)}
          >
            {k.label}
          </button>
        )
      })}
    </div>
  )
}
