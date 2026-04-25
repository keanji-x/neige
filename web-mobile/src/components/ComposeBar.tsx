import { useRef, useState } from 'react'

interface Props {
  /** When true, render the full-width Stop button instead of the textarea. */
  busy: boolean
  /** Text the user typed. For terminal mode the parent appends `\r` itself if needed. */
  onSend: (text: string) => void
  /** Optional Stop handler. Required when `busy` can become true. */
  onStop?: () => void
  /** Placeholder for the textarea. */
  placeholder?: string
  /**
   * Terminal mode: empty input → send `\r`, otherwise append `\r` to the text
   * before calling `onSend`. Chat mode: send the trimmed text as-is.
   */
  variant?: 'terminal' | 'chat'
}

/**
 * Compose bar shared by terminal and chat panes:
 *   - Claude running (busy) → full-width red Stop button (terminal sends Esc)
 *   - Otherwise → textarea + Send button.
 * Phone keyboards don't have a dedicated "Enter to send" contract, so we route
 * sending through an always-visible button to avoid stray submits.
 */
export function ComposeBar({
  busy,
  onSend,
  onStop,
  placeholder = 'message Claude…',
  variant = 'terminal',
}: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const send = () => {
    if (variant === 'terminal') {
      if (!text) {
        onSend('\r')
        return
      }
      onSend(text + '\r')
    } else {
      const trimmed = text.trim()
      if (!trimmed) return
      onSend(trimmed)
    }
    setText('')
    ref.current?.focus()
  }

  if (busy && onStop) {
    return (
      <div className="compose compose-busy">
        <button className="stop-btn" onClick={onStop}>
          <span className="stop-icon">■</span>
          <span>Stop</span>
        </button>
      </div>
    )
  }

  return (
    <div className="compose">
      <textarea
        ref={ref}
        className="compose-input"
        placeholder={placeholder}
        rows={1}
        value={text}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="send-btn" onClick={send} aria-label="send">
        ➤
      </button>
    </div>
  )
}
