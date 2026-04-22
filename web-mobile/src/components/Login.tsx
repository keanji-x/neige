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
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-title">neige</div>
        <div className="login-subtitle">mobile · sign in</div>
        <input
          className="login-input"
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
        {err && <div className="login-err">{err}</div>}
        <button className="login-btn" type="submit" disabled={pending || !token}>
          {pending ? '...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
