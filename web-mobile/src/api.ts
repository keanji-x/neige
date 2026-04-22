import { authStore } from './authStore'
import type { BrowseResponse, ConvInfo, CreateConvRequest } from './types'

/**
 * Thin wrapper around fetch that signals the auth store when the server
 * returns 401 — lets any expired-session response bounce the user back to
 * the login screen without callbacks needing to thread through the tree.
 */
async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) authStore.setAnonymous()
  return res
}

export async function whoami(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/whoami')
    return res.ok
  } catch {
    return false
  }
}

export async function login(token: string): Promise<boolean> {
  const res = await fetch('/login/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  return res.ok
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

export async function listConversations(): Promise<ConvInfo[]> {
  const res = await authedFetch('/api/conversations')
  if (!res.ok) throw new Error('failed to list conversations')
  return res.json()
}

export async function resumeConversation(id: string): Promise<ConvInfo> {
  const res = await authedFetch(`/api/conversations/${id}/resume`, { method: 'POST' })
  if (!res.ok) throw new Error('failed to resume')
  return res.json()
}

export async function renameConversation(id: string, title: string): Promise<ConvInfo> {
  const res = await authedFetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await authedFetch(`/api/conversations/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `HTTP ${res.status}`)
  }
}

export async function browseDir(path: string): Promise<BrowseResponse> {
  const url = `/api/browse?path=${encodeURIComponent(path)}`
  const res = await authedFetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `HTTP ${res.status}`)
  }
  return res.json()
}

export interface NeigeConfig {
  proxy?: string
  [key: string]: unknown
}

export async function getConfig(): Promise<NeigeConfig> {
  const res = await authedFetch('/api/config')
  if (!res.ok) return {}
  try {
    return (await res.json()) as NeigeConfig
  } catch {
    return {}
  }
}

export async function saveConfig(cfg: NeigeConfig): Promise<void> {
  await authedFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
}

export async function createConversation(req: CreateConvRequest): Promise<ConvInfo> {
  const res = await authedFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `HTTP ${res.status}`)
  }
  return res.json()
}
