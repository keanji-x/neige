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
        placeholder="message Claude…"
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
