import { useState } from 'react'
import type { ConvInfo } from '../types'

interface Props {
  conv: ConvInfo
  onRename: (title: string) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

/**
 * Bottom-sheet action menu for a single card. Three actions:
 *   - Rename: swap the sheet body to an inline text input; on save PATCHes the
 *     conversation title.
 *   - Delete: destructive — kills the PTY and removes the session server-side.
 *     Two-step: first tap turns the row red and asks for confirmation.
 *   - Copy ID: clipboard API with a prompt() fallback for non-secure contexts
 *     (HTTP LAN access often isn't considered secure).
 */
export function CardMenu({ conv, onRename, onDelete, onClose }: Props) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'confirmDelete'>('menu')
  const [newTitle, setNewTitle] = useState(conv.title)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)

  const doRename = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = newTitle.trim()
    if (!t || t === conv.title) {
      onClose()
      return
    }
    setPending(true)
    setErr(null)
    try {
      await onRename(t)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  const doDelete = async () => {
    setPending(true)
    setErr(null)
    try {
      await onDelete()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setPending(false)
    }
  }

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(conv.id)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
        onClose()
      }, 800)
    } catch {
      // Insecure context or API unavailable — fall back to prompt
      prompt('复制这个 ID：', conv.id)
      onClose()
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet-menu" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <div className="sheet-menu-head">
            <div className="sheet-menu-title">{conv.title}</div>
            <div className="sheet-menu-id">{conv.id.slice(0, 8)}…</div>
          </div>
          <button className="link-btn" onClick={onClose}>
            取消
          </button>
        </header>

        {mode === 'menu' && (
          <div className="menu-body">
            <button className="menu-row" onClick={() => setMode('rename')}>
              <span className="menu-ico">✎</span>
              <span>重命名</span>
            </button>
            <button className="menu-row" onClick={copyId}>
              <span className="menu-ico">⧉</span>
              <span>{copied ? '已复制' : '复制 session ID'}</span>
            </button>
            <button
              className="menu-row menu-row-danger"
              onClick={() => setMode('confirmDelete')}
            >
              <span className="menu-ico">✕</span>
              <span>删除 session（不可撤销）</span>
            </button>
          </div>
        )}

        {mode === 'rename' && (
          <form className="menu-rename" onSubmit={doRename}>
            <input
              className="field-input"
              value={newTitle}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            {err && <div className="form-err">{err}</div>}
            <div className="menu-actions">
              <button
                type="button"
                className="menu-btn menu-btn-ghost"
                onClick={() => setMode('menu')}
                disabled={pending}
              >
                返回
              </button>
              <button type="submit" className="menu-btn menu-btn-primary" disabled={pending}>
                {pending ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        )}

        {mode === 'confirmDelete' && (
          <div className="menu-confirm">
            <p className="menu-confirm-text">
              确认删除 <strong>{conv.title}</strong>？
              <br />
              该 session 的 PTY 会被杀掉，所有客户端（桌面 + 其他手机）都会断开。
            </p>
            {err && <div className="form-err">{err}</div>}
            <div className="menu-actions">
              <button
                type="button"
                className="menu-btn menu-btn-ghost"
                onClick={() => setMode('menu')}
                disabled={pending}
              >
                算了
              </button>
              <button
                type="button"
                className="menu-btn menu-btn-danger"
                onClick={doDelete}
                disabled={pending}
              >
                {pending ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
