import clsx from 'clsx'

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
    <div
      className="flex flex-wrap gap-1.5 py-1.5 px-2 border-t border-border bg-bg-tertiary"
      role="toolbar"
      aria-label="shortcuts"
    >
      {KEYS.map((k) => {
        const isWide = k.variant === 'wide'
        const isMacro = k.variant === 'macro'
        return (
          <button
            key={k.label}
            className={clsx(
              // Base key-btn
              'shrink-0 h-9 rounded-[8px] border font-mono font-medium',
              // Default dims
              !isWide && !isMacro && 'min-w-10 px-2.5 bg-bg-elevated border-border text-text-secondary text-base active:bg-green-dim active:text-text-primary active:border-action',
              // Wide enter
              isWide && 'min-w-16 px-2.5 bg-action text-white border-action text-lg active:bg-action-hover',
              // Macro (/rewind)
              isMacro && 'min-w-10 px-3 bg-bg-secondary text-action border-green-dim font-sans text-sm font-semibold tracking-normal active:bg-green-dim active:text-white active:border-action',
            )}
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
