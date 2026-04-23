interface Props {
  onKey: (seq: string) => void
  onAction: (action: 'scrollBottom') => void
}

type KeyVariant = 'macro' | 'wide' | 'accent'

type KeyDef =
  | { kind: 'seq'; label: string; seq: string; variant?: KeyVariant }
  | { kind: 'action'; label: string; action: 'scrollBottom'; variant?: KeyVariant }

// Claude-friendly shortcuts, not a generic terminal key bar.
// Numbers 1/2/3 cover Claude's menu choices; Esc interrupts; ↑↓ history.
// Macros (/rewind, ⌃C) are one-tap; ⤓ is a UI action (scroll viewport to
// live tail), not a terminal input.
const KEYS: KeyDef[] = [
  { kind: 'seq', label: 'Esc', seq: '\x1b' },
  { kind: 'seq', label: '⌃C', seq: '\x03' },
  { kind: 'seq', label: '/rewind', seq: '/rewind\r', variant: 'macro' },
  { kind: 'seq', label: '1', seq: '1' },
  { kind: 'seq', label: '2', seq: '2' },
  { kind: 'seq', label: '3', seq: '3' },
  { kind: 'seq', label: '↑', seq: '\x1b[A' },
  { kind: 'seq', label: '↓', seq: '\x1b[B' },
  { kind: 'seq', label: '←', seq: '\x1b[D' },
  { kind: 'seq', label: '→', seq: '\x1b[C' },
  { kind: 'action', label: '⤓', action: 'scrollBottom', variant: 'accent' },
  { kind: 'seq', label: '⌫', seq: '\x7f' },
  { kind: 'seq', label: '/', seq: '/' },
  { kind: 'seq', label: '⏎', seq: '\r', variant: 'wide' },
]

export function KeyBar({ onKey, onAction }: Props) {
  const tap = (k: KeyDef) => {
    if (k.kind === 'seq') onKey(k.seq)
    else onAction(k.action)
    if ('vibrate' in navigator) navigator.vibrate?.(8)
  }
  return (
    <div className="key-bar" role="toolbar" aria-label="shortcuts">
      {KEYS.map((k) => {
        const variantClass =
          k.variant === 'wide'
            ? ' key-wide'
            : k.variant === 'macro'
              ? ' key-macro'
              : k.variant === 'accent'
                ? ' key-accent'
                : ''
        return (
          <button
            key={k.label}
            className={`key-btn${variantClass}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => tap(k)}
            aria-label={k.kind === 'action' && k.action === 'scrollBottom' ? 'scroll to bottom' : undefined}
          >
            {k.label}
          </button>
        )
      })}
    </div>
  )
}
