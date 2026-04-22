import { useSyncExternalStore } from 'react'

/**
 * Auth state lives in a singleton so any API wrapper can signal "session
 * expired" on a 401 without passing callbacks down component trees. React
 * components subscribe via useAuth (below).
 */

export type AuthState = 'checking' | 'anonymous' | 'authed'

let state: AuthState = 'checking'
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export const authStore = {
  get(): AuthState {
    return state
  },
  setChecking() {
    if (state !== 'checking') {
      state = 'checking'
      emit()
    }
  },
  setAuthed() {
    if (state !== 'authed') {
      state = 'authed'
      emit()
    }
  },
  setAnonymous() {
    if (state !== 'anonymous') {
      state = 'anonymous'
      emit()
    }
  },
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

export function useAuthState(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get)
}
