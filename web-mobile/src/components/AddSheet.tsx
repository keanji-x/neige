import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, Sheet, SheetContent } from '@neige/shared'
import type { ConvInfo, CreateConvRequest } from '../types'
import { getConfig, saveConfig } from '../api'
import { DirPicker } from './DirPicker'

interface Props {
  conversations: ConvInfo[]
  inStack: string[]
  onPickExisting: (id: string) => void
  onPickMany: (ids: string[]) => void
  onCreate: (req: CreateConvRequest) => Promise<void>
  onClose: () => void
}

type Mode = 'existing' | 'new'

function shortCwd(cwd: string): string {
  const home = '/home/'
  if (cwd.startsWith(home)) {
    const rest = cwd.slice(home.length)
    const slash = rest.indexOf('/')
    return slash === -1 ? `~${rest}` : `~${rest.slice(slash)}`
  }
  return cwd
}

function StatusDot({ status }: { status: ConvInfo['status'] }) {
  return (
    <span
      className={clsx(
        'inline-block w-2 h-2 rounded-full shrink-0',
        status === 'running' &&
          'bg-status-running shadow-[0_0_6px_rgba(63,185,80,0.45)]',
        status === 'detached' && 'bg-yellow',
        status === 'dead' && 'bg-red',
        status !== 'running' &&
          status !== 'detached' &&
          status !== 'dead' &&
          'bg-text-muted',
      )}
    />
  )
}

export function AddSheet({
  conversations,
  inStack,
  onPickExisting,
  onPickMany,
  onCreate,
  onClose,
}: Props) {
  const taken = new Set(inStack)
  const available = conversations.filter((c) => !taken.has(c.id))
  const [mode, setMode] = useState<Mode>(available.length > 0 ? 'existing' : 'new')

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent className="p-0">
        <div className="bg-bg-primary border-t border-border rounded-t-[16px] w-full max-h-[80%] flex flex-col pb-[env(safe-area-inset-bottom)]">
          <header className="flex items-center justify-between py-2.5 px-[14px] border-b border-border gap-2.5">
            <div className="flex gap-1 bg-bg-tertiary p-1 rounded-[8px]">
              <button
                className={clsx(
                  'py-1.5 px-[14px] text-sm font-medium rounded-[6px]',
                  mode === 'existing'
                    ? 'bg-bg-elevated text-text-primary'
                    : 'text-text-muted',
                )}
                onClick={() => setMode('existing')}
              >
                加入已有
              </button>
              <button
                className={clsx(
                  'py-1.5 px-[14px] text-sm font-medium rounded-[6px]',
                  mode === 'new'
                    ? 'bg-bg-elevated text-text-primary'
                    : 'text-text-muted',
                )}
                onClick={() => setMode('new')}
              >
                新建
              </button>
            </div>
            <button
              className="text-text-muted text-sm px-2.5 py-1.5 active:text-text-primary"
              onClick={onClose}
            >
              取消
            </button>
          </header>
          <div className="flex-1 overflow-y-auto">
            {mode === 'existing' && (
              <ExistingList
                conversations={conversations}
                available={available}
                onPick={onPickExisting}
                onPickAll={() => onPickMany(available.map((c) => c.id))}
              />
            )}
            {mode === 'new' && (
              <NewSessionForm conversations={conversations} onCreate={onCreate} />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ExistingList({
  conversations,
  available,
  onPick,
  onPickAll,
}: {
  conversations: ConvInfo[]
  available: ConvInfo[]
  onPick: (id: string) => void
  onPickAll: () => void
}) {
  return (
    <>
      {conversations.length === 0 && (
        <div className="py-12 px-6 text-center text-text-muted">
          <p>server 上没有会话</p>
          <p className="text-sm mt-1">切到"新建"tab 建一个</p>
        </div>
      )}
      {conversations.length > 0 && available.length === 0 && (
        <div className="py-12 px-6 text-center text-text-muted">
          <p>所有会话都已加入 stack</p>
        </div>
      )}
      {available.length > 1 && (
        <button
          className="flex items-center gap-3 w-full py-[14px] px-[18px] border-b border-border text-left bg-bg-hover justify-center active:bg-bg-hover"
          onClick={onPickAll}
        >
          <span className="shrink-0 flex flex-col items-center gap-[3px]">
            <span className="text-[15px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
              加入全部（{available.length}）
            </span>
          </span>
        </button>
      )}
      {available.map((c) => (
        <button
          key={c.id}
          className="flex items-center gap-3 w-full py-[14px] px-[18px] border-b border-border text-left active:bg-bg-hover"
          onClick={() => onPick(c.id)}
        >
          <StatusDot status={c.status} />
          <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
            <span className="text-[15px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
              {c.title}
            </span>
            <span className="text-[12px] text-text-muted font-mono whitespace-nowrap overflow-hidden text-ellipsis">
              {shortCwd(c.effective_cwd)}
            </span>
          </span>
        </button>
      ))}
    </>
  )
}

function NewSessionForm({
  conversations,
  onCreate,
}: {
  conversations: ConvInfo[]
  onCreate: (req: CreateConvRequest) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [cwd, setCwd] = useState('')
  const [useWorktree, setUseWorktree] = useState(true)
  const [worktreeName, setWorktreeName] = useState('')
  const [proxy, setProxy] = useState('')
  const [savedProxy, setSavedProxy] = useState('')
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)

  // Prefill proxy from the server-side config so most users don't need to
  // retype it every time. We remember whatever they last saved and diff on
  // submit to decide whether to push an update.
  useEffect(() => {
    let cancelled = false
    getConfig().then((cfg) => {
      if (cancelled) return
      const p = cfg.proxy ?? ''
      setProxy(p)
      setSavedProxy(p)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Suggest cwds we've seen used before so user rarely has to type a path.
  const cwdSuggestions = Array.from(
    new Set(conversations.map((c) => c.cwd)),
  ).slice(0, 6)

  const canSubmit = title.trim() !== '' && cwd.trim() !== '' && !pending

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setErr(null)
    try {
      const proxyVal = proxy.trim()
      if (proxyVal !== savedProxy) {
        // Persist so the next session picks the same proxy by default.
        await saveConfig({ proxy: proxyVal || undefined })
        setSavedProxy(proxyVal)
      }
      await onCreate({
        title: title.trim(),
        program: 'claude',
        cwd: cwd.trim(),
        use_worktree: useWorktree,
        worktree_name: worktreeName.trim() || undefined,
        proxy: proxyVal || undefined,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  const fieldInputCls =
    'h-[42px] px-3 bg-bg-tertiary border border-border rounded-[8px] text-lg text-text-primary focus:border-action focus:outline-none'
  const fieldLabelCls =
    'text-[12px] text-text-muted uppercase tracking-[0.06em]'
  const fieldCls = 'flex flex-col gap-1.5'
  const monoCls = 'font-mono text-base'

  return (
    <form className="flex flex-col gap-[14px] py-4 px-[18px] pb-5" onSubmit={submit}>
      <label className={fieldCls}>
        <span className={fieldLabelCls}>名称</span>
        <input
          className={fieldInputCls}
          type="text"
          value={title}
          placeholder="e.g. fix-login-bug"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className={fieldCls}>
        <span className={fieldLabelCls}>工作目录</span>
        <div className="flex gap-1.5">
          <input
            className={clsx(fieldInputCls, monoCls, 'flex-1 min-w-0')}
            type="text"
            value={cwd}
            placeholder="/home/kenji/..."
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setCwd(e.target.value)}
          />
          <button
            type="button"
            className="shrink-0 w-[46px] h-[42px] bg-bg-elevated border border-border rounded-[8px] text-[18px] active:bg-green-dim active:border-action"
            onClick={() => setBrowsing(true)}
            aria-label="browse directories"
          >
            📁
          </button>
        </div>
      </label>

      {browsing && (
        <DirPicker
          initial={cwd}
          onPick={(p) => {
            setCwd(p)
            setBrowsing(false)
          }}
          onClose={() => setBrowsing(false)}
        />
      )}

      {cwdSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 -mt-1">
          {cwdSuggestions.map((s) => (
            <button
              type="button"
              key={s}
              className="py-1.5 px-2.5 bg-bg-elevated border border-border rounded-[8px] text-text-secondary font-mono text-[12px] whitespace-nowrap max-w-full overflow-hidden text-ellipsis active:bg-green-dim active:border-action active:text-text-primary"
              onClick={() => setCwd(s)}
            >
              {shortCwd(s)}
            </button>
          ))}
        </div>
      )}

      <label className="flex items-center justify-between gap-3 p-3 bg-bg-secondary border border-border rounded-[8px]">
        <span className="flex flex-col gap-[3px]">
          <span className="text-base font-medium">使用 worktree</span>
          <span className="text-[12px] text-text-muted">每个 session 独立的 git 分支</span>
        </span>
        <input
          type="checkbox"
          checked={useWorktree}
          onChange={(e) => setUseWorktree(e.target.checked)}
        />
      </label>

      {useWorktree && (
        <label className={fieldCls}>
          <span className={fieldLabelCls}>worktree 名（可选）</span>
          <input
            className={clsx(fieldInputCls, monoCls)}
            type="text"
            value={worktreeName}
            placeholder="auto"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setWorktreeName(e.target.value)}
          />
        </label>
      )}

      <label className={fieldCls}>
        <span className={fieldLabelCls}>HTTP 代理（可选）</span>
        <input
          className={clsx(fieldInputCls, monoCls)}
          type="url"
          value={proxy}
          placeholder="http://127.0.0.1:10809"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setProxy(e.target.value)}
        />
      </label>

      {err && (
        <div className="text-red text-sm py-2 px-2.5 bg-[rgba(248,81,73,0.08)] border border-[rgba(248,81,73,0.3)] rounded-[8px]">
          {err}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        className="w-full touch:h-12"
        disabled={!canSubmit}
      >
        {pending ? '创建中…' : '创建 session'}
      </Button>
    </form>
  )
}
