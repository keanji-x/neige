import { useEffect } from 'react'
import { authStore, useAuthState } from './authStore'
import { whoami } from './api'

export function useAuth() {
  const state = useAuthState()

  useEffect(() => {
    let cancelled = false
    // Only probe on first mount (or when we return to checking state).
    if (authStore.get() !== 'checking') return
    whoami().then((ok) => {
      if (cancelled) return
      if (ok) authStore.setAuthed()
      else authStore.setAnonymous()
    })
    return () => {
      cancelled = true
    }
  }, [])

  return {
    state,
    markAuthed: () => authStore.setAuthed(),
    markAnonymous: () => authStore.setAnonymous(),
  }
}
