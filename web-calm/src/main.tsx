import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { configureApi } from '@neige/shared/api'
import { AuthGate } from './AuthGate'
import { CalmApp } from './CalmApp'
import './calm.css'

// Mid-session 401 (token rotated, cookie expired) → reload. AuthGate then
// sees whoami() return false and renders <LoginPage /> instead of <CalmApp />.
// Skip reload if we're already showing the login form to avoid loops.
configureApi({
  onUnauthorized: () => {
    if (typeof window === 'undefined') return
    // The login form itself calls authedFetch via login() which never 401s
    // (it succeeds or returns 400); even if it did, reloading from a login
    // page just shows the login page again, which is fine.
    window.location.reload()
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <CalmApp />
    </AuthGate>
  </StrictMode>,
)
