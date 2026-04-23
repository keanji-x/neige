import { useRef, useState } from 'react'

interface Props {
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
}

/**
 * Compose bar:
 *   - Claude running (busy) → full-width red Stop button (sends Esc)
 *   - Otherwise → textarea + Send button. Enter = newline; Send = text + \r.
 * Phone keyboards don't have a dedicated "Enter to send" contract, so we route
 * sending through an always-visible button to avoid stray submits.
 */
export function ComposeBar({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const send = () => {
    if (!text) {
      onSend('\r')
      return
    }
    onSend(text + '\r')
    setText('')
    ref.current?.focus()
  }

  if (busy) {
    return (
      <div className="flex items-end gap-2 pt-2 pb-2.5 px-2.5 border-t border-border bg-bg-secondary p-2.5">
        <button
          className="flex items-center justify-center gap-2.5 w-full h-12 rounded-[12px] bg-red text-white text-lg font-semibold active:bg-[#d6382f]"
          onClick={onStop}
        >
          <span className="text-base">■</span>
          <span>Stop</span>
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2 pt-2 pb-2.5 px-2.5 border-t border-border bg-bg-secondary">
      <textarea
        ref={ref}
        className="flex-1 min-h-[40px] max-h-[140px] py-2.5 px-3 bg-bg-tertiary border border-border rounded-[8px] font-mono text-[15px] leading-[1.4] text-text-primary resize-none focus:border-action focus:outline-none"
        placeholder="message Claude…"
        rows={1}
        value={text}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="shrink-0 w-11 h-10 rounded-[8px] bg-action text-white text-lg font-semibold grid place-items-center active:bg-action-hover"
        onClick={send}
        aria-label="send"
      >
        ➤
      </button>
    </div>
  )
}
