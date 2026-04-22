import { useEffect, useState } from 'react'
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
    <div className="dir-picker-backdrop" onClick={onClose}>
      <div className="dir-picker" onClick={(e) => e.stopPropagation()}>
        <header className="dir-head">
          <div className="dir-head-main">
            <div className="dir-head-title">选择目录</div>
            <div className="dir-head-path">
              {currentPath}
              {data?.is_git_repo && <span className="dir-git-tag">git</span>}
            </div>
          </div>
          <button className="link-btn" onClick={onClose}>
            取消
          </button>
        </header>

        <div className="dir-toolbar">
          <button
            className="dir-up"
            onClick={goUp}
            disabled={!data || data.path === '/'}
          >
            ‹ 上级
          </button>
          <button className="dir-use" onClick={() => data && onPick(data.path)} disabled={!data}>
            使用此目录
          </button>
        </div>

        <div className="dir-list">
          {loading && <div className="dir-info">loading…</div>}
          {err && <div className="dir-info dir-err">{err}</div>}
          {!loading && !err && data?.entries.length === 0 && (
            <div className="dir-info">（空目录）</div>
          )}
          {!loading &&
            !err &&
            data?.entries.map((e) => (
              <button
                key={e.name}
                className={`dir-row${e.is_dir ? '' : ' dir-file'}`}
                disabled={!e.is_dir}
                onClick={() => e.is_dir && goInto(e.name)}
              >
                <span className="dir-icon">{e.is_dir ? '📁' : '📄'}</span>
                <span className="dir-name">{e.name}</span>
                {e.is_dir && <span className="dir-chevron">›</span>}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
