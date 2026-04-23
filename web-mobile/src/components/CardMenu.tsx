import { useState } from 'react'
import clsx from 'clsx'
import { Sheet, SheetContent } from '@neige/shared'
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

  const menuBtnBase =
    'flex-1 h-11 rounded-[8px] text-base font-semibold disabled:opacity-50'
  const fieldInputCls =
    'h-[42px] px-3 bg-bg-tertiary border border-border rounded-[8px] text-lg text-text-primary focus:border-action focus:outline-none'
  const formErrCls =
    'text-red text-sm py-2 px-2.5 bg-[rgba(248,81,73,0.08)] border border-[rgba(248,81,73,0.3)] rounded-[8px]'

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent className="p-0">
        <div className="bg-bg-primary border-t border-border rounded-t-[16px] w-full flex flex-col pb-[env(safe-area-inset-bottom)]">
          <header className="flex items-center justify-between py-2.5 px-[14px] border-b border-border gap-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
                {conv.title}
              </div>
              <div className="text-xs text-text-muted font-mono mt-0.5">
                {conv.id.slice(0, 8)}…
              </div>
            </div>
            <button
              className="text-text-muted text-sm px-2.5 py-1.5 active:text-text-primary"
              onClick={onClose}
            >
              取消
            </button>
          </header>

          {mode === 'menu' && (
            <div className="flex flex-col pt-1.5 pb-2">
              <button
                className="flex items-center gap-[14px] py-[14px] px-[18px] text-[15px] text-text-primary text-left active:bg-bg-hover"
                onClick={() => setMode('rename')}
              >
                <span className="shrink-0 basis-6 text-center text-text-muted text-base">✎</span>
                <span>重命名</span>
              </button>
              <button
                className="flex items-center gap-[14px] py-[14px] px-[18px] text-[15px] text-text-primary text-left active:bg-bg-hover"
                onClick={copyId}
              >
                <span className="shrink-0 basis-6 text-center text-text-muted text-base">⧉</span>
                <span>{copied ? '已复制' : '复制 session ID'}</span>
              </button>
              <button
                className="flex items-center gap-[14px] py-[14px] px-[18px] text-[15px] text-red text-left active:bg-bg-hover"
                onClick={() => setMode('confirmDelete')}
              >
                <span className="shrink-0 basis-6 text-center text-red text-base">✕</span>
                <span>删除 session（不可撤销）</span>
              </button>
            </div>
          )}

          {mode === 'rename' && (
            <form
              className="flex flex-col gap-3 py-4 px-[18px] pb-5"
              onSubmit={doRename}
            >
              <input
                className={fieldInputCls}
                value={newTitle}
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              {err && <div className={formErrCls}>{err}</div>}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={clsx(
                    menuBtnBase,
                    'bg-bg-elevated text-text-secondary border border-border active:enabled:bg-bg-hover',
                  )}
                  onClick={() => setMode('menu')}
                  disabled={pending}
                >
                  返回
                </button>
                <button
                  type="submit"
                  className={clsx(
                    menuBtnBase,
                    'bg-action text-white active:enabled:bg-action-hover',
                  )}
                  disabled={pending}
                >
                  {pending ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          )}

          {mode === 'confirmDelete' && (
            <div className="flex flex-col gap-3 py-4 px-[18px] pb-5">
              <p className="m-0 text-base text-text-secondary leading-[1.5]">
                确认删除 <strong>{conv.title}</strong>？
                <br />
                该 session 的 PTY 会被杀掉，所有客户端（桌面 + 其他手机）都会断开。
              </p>
              {err && <div className={formErrCls}>{err}</div>}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={clsx(
                    menuBtnBase,
                    'bg-bg-elevated text-text-secondary border border-border active:enabled:bg-bg-hover',
                  )}
                  onClick={() => setMode('menu')}
                  disabled={pending}
                >
                  算了
                </button>
                <button
                  type="button"
                  className={clsx(
                    menuBtnBase,
                    'bg-red text-white active:enabled:bg-[#d6382f]',
                  )}
                  onClick={doDelete}
                  disabled={pending}
                >
                  {pending ? '删除中…' : '确认删除'}
                </button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
