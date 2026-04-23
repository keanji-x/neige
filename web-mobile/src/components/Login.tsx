import { useState } from 'react'
import { login } from '../api'

interface Props {
  onAuthed: () => void
}

export function Login({ onAuthed }: Props) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setPending(true)
    setErr(null)
    const ok = await login(token)
    setPending(false)
    if (ok) onAuthed()
    else setErr('密码错误或登录受限')
  }

  return (
    <div className="grid place-items-center h-full p-6">
      <form
        className="w-full max-w-[360px] flex flex-col gap-[14px] py-7 px-6 bg-bg-secondary border border-border rounded-[16px]"
        onSubmit={submit}
      >
        <div className="text-[22px] font-semibold tracking-[-0.01em]">neige</div>
        <div className="text-[12px] text-text-muted mb-2 uppercase tracking-[0.08em]">
          mobile · sign in
        </div>
        <input
          className="h-[46px] px-[14px] bg-bg-tertiary border border-border rounded-[8px] text-lg text-text-primary focus:border-action focus:outline-none"
          type="password"
          inputMode="text"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {err && <div className="text-red text-sm">{err}</div>}
        <button
          className="h-[46px] rounded-[8px] bg-action text-white font-semibold text-[15px] disabled:opacity-50"
          type="submit"
          disabled={pending || !token}
        >
          {pending ? '...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
