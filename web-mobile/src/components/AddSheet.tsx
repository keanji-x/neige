import { useEffect, useState } from 'react'
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
        <div className="sheet">
          <header className="sheet-head">
            <div className="sheet-tabs">
              <button
                className={`sheet-tab${mode === 'existing' ? ' active' : ''}`}
                onClick={() => setMode('existing')}
              >
                加入已有
              </button>
              <button
                className={`sheet-tab${mode === 'new' ? ' active' : ''}`}
                onClick={() => setMode('new')}
              >
                新建
              </button>
            </div>
            <button className="link-btn" onClick={onClose}>
              取消
            </button>
          </header>
          <div className="sheet-body">
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
        <div className="empty">
          <p>server 上没有会话</p>
          <p className="empty-hint">切到"新建"tab 建一个</p>
        </div>
      )}
      {conversations.length > 0 && available.length === 0 && (
        <div className="empty">
          <p>所有会话都已加入 stack</p>
        </div>
      )}
      {available.length > 1 && (
        <button className="sheet-row sheet-row-all" onClick={onPickAll}>
          <span className="sheet-row-main">
            <span className="sheet-row-title">加入全部（{available.length}）</span>
          </span>
        </button>
      )}
      {available.map((c) => (
        <button key={c.id} className="sheet-row" onClick={() => onPick(c.id)}>
          <span className={`status-dot status-${c.status}`} />
          <span className="sheet-row-main">
            <span className="sheet-row-title">{c.title}</span>
            <span className="sheet-row-cwd">{shortCwd(c.effective_cwd)}</span>
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

  return (
    <form className="new-form" onSubmit={submit}>
      <label className="field">
        <span className="field-label">名称</span>
        <input
          className="field-input"
          type="text"
          value={title}
          placeholder="e.g. fix-login-bug"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">工作目录</span>
        <div className="field-row">
          <input
            className="field-input field-mono"
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
            className="field-side-btn"
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
        <div className="chip-row">
          {cwdSuggestions.map((s) => (
            <button
              type="button"
              key={s}
              className="chip"
              onClick={() => setCwd(s)}
            >
              {shortCwd(s)}
            </button>
          ))}
        </div>
      )}

      <label className="toggle-row">
        <span className="toggle-main">
          <span className="toggle-title">使用 worktree</span>
          <span className="toggle-desc">每个 session 独立的 git 分支</span>
        </span>
        <input
          type="checkbox"
          checked={useWorktree}
          onChange={(e) => setUseWorktree(e.target.checked)}
        />
      </label>

      {useWorktree && (
        <label className="field">
          <span className="field-label">worktree 名（可选）</span>
          <input
            className="field-input field-mono"
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

      <label className="field">
        <span className="field-label">HTTP 代理（可选）</span>
        <input
          className="field-input field-mono"
          type="url"
          value={proxy}
          placeholder="http://127.0.0.1:10809"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setProxy(e.target.value)}
        />
      </label>

      {err && <div className="form-err">{err}</div>}

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
