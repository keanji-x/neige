import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Sheet, SheetContent } from '@neige/shared'
import { browseDir } from '../api'
import type { BrowseResponse } from '../types'

interface Props {
  initial: string
  onPick: (path: string) => void
  onClose: () => void
}

/**
 * Full-screen directory picker that talks to GET /api/browse. Entries come back
 * sorted dirs-first with hidden files filtered out server-side. Files render
 * greyed-out so the user can orient but can't accidentally "pick" one — only
 * directories are valid cwd targets.
 */
export function DirPicker({ initial, onPick, onClose }: Props) {
  const [data, setData] = useState<BrowseResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const browse = (p: string) => {
    setLoading(true)
    setErr(null)
    browseDir(p)
      .then((r) => {
        setData(r)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    browse(initial && initial.trim() !== '' ? initial : '~')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goInto = (name: string) => {
    if (!data) return
    const base = data.path.replace(/\/+$/, '')
    browse(`${base}/${name}`)
  }
  const goUp = () => {
    if (!data) return
    if (data.path === '/' || data.path === '') return
    const parent = data.path.replace(/\/[^/]+\/?$/, '') || '/'
    browse(parent)
  }

  const currentPath = data?.path ?? initial

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent className="p-0 max-h-[100vh] h-[100vh] rounded-t-lg">
        <div className="bg-bg-primary border-t border-border rounded-t-[16px] w-full h-[90%] flex flex-col pb-[env(safe-area-inset-bottom)]">
          <header className="flex items-start justify-between pt-[14px] px-4 pb-3 border-b border-border gap-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold">选择目录</div>
              <div className="font-mono text-[12px] text-text-muted mt-1 break-all flex items-center gap-1.5">
                {currentPath}
                {data?.is_git_repo && (
                  <span className="shrink-0 py-[1px] px-1.5 bg-green-dim text-action rounded-[3px] text-[10px] font-sans uppercase tracking-[0.05em]">
                    git
                  </span>
                )}
              </div>
            </div>
            <button
              className="text-text-muted text-sm px-2.5 py-1.5 active:text-text-primary"
              onClick={onClose}
            >
              取消
            </button>
          </header>

          <div className="flex gap-2 py-2 px-3 border-b border-border bg-bg-secondary">
            <button
              className="shrink-0 py-2 px-3 bg-bg-elevated border border-border rounded-[8px] text-text-secondary text-sm active:enabled:bg-bg-hover active:enabled:text-text-primary disabled:opacity-40"
              onClick={goUp}
              disabled={!data || data.path === '/'}
            >
              ‹ 上级
            </button>
            <button
              className="flex-1 py-2 px-3 bg-action text-white rounded-[8px] text-sm font-semibold active:enabled:bg-action-hover disabled:opacity-40"
              onClick={() => data && onPick(data.path)}
              disabled={!data}
            >
              使用此目录
            </button>
          </div>

          <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
            {loading && (
              <div className="py-6 px-4 text-center text-text-muted text-sm">loading…</div>
            )}
            {err && (
              <div className="py-6 px-4 text-center text-red text-sm">{err}</div>
            )}
            {!loading && !err && data?.entries.length === 0 && (
              <div className="py-6 px-4 text-center text-text-muted text-sm">（空目录）</div>
            )}
            {!loading &&
              !err &&
              data?.entries.map((e) => (
                <button
                  key={e.name}
                  className={clsx(
                    'flex items-center gap-2.5 w-full py-3 px-4 border-b border-border text-left text-base',
                    e.is_dir
                      ? 'text-text-primary active:enabled:bg-bg-hover'
                      : 'text-text-muted disabled:cursor-default',
                  )}
                  disabled={!e.is_dir}
                  onClick={() => e.is_dir && goInto(e.name)}
                >
                  <span className="shrink-0 text-[15px]">{e.is_dir ? '📁' : '📄'}</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono">
                    {e.name}
                  </span>
                  {e.is_dir && (
                    <span className="text-text-muted text-lg shrink-0">›</span>
                  )}
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
