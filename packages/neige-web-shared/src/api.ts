import type {
  BrowseResponse,
  ConvInfo,
  CreateConvRequest,
  NeigeConfig,
} from './types';

/**
 * Configurable callback fired when the server returns 401 on an authed fetch.
 * Each frontend wires this up at startup — desktop redirects to /login, mobile
 * flips its auth store to "anonymous".
 */
let onUnauthorized: (() => void) | null = null;

export function configureApi(opts: { onUnauthorized?: () => void }): void {
  onUnauthorized = opts.onUnauthorized ?? null;
}

/**
 * Thin wrapper around fetch that invokes the configured 401 handler. Keeps
 * expired-session handling out of every call site. Exported so components
 * that need raw Response access (headers, HEAD requests, streaming, etc.)
 * can still pipe through the same 401 behavior.
 */
export async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) onUnauthorized?.();
  return res;
}

export async function whoami(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/whoami');
    return res.ok;
  } catch {
    return false;
  }
}

export async function login(token: string): Promise<boolean> {
  const res = await fetch('/login/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export async function listConversations(signal?: AbortSignal): Promise<ConvInfo[]> {
  const res = await authedFetch('/api/conversations', signal ? { signal } : undefined);
  if (!res.ok) throw new Error('failed to list conversations');
  return res.json();
}

export async function resumeConversation(id: string): Promise<ConvInfo> {
  const res = await authedFetch(`/api/conversations/${id}/resume`, { method: 'POST' });
  if (!res.ok) throw new Error('failed to resume');
  return res.json();
}

export async function renameConversation(id: string, title: string): Promise<ConvInfo> {
  const res = await authedFetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await authedFetch(`/api/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `HTTP ${res.status}`);
  }
}

export async function createConversation(req: CreateConvRequest): Promise<ConvInfo> {
  const res = await authedFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function browseDir(path: string): Promise<BrowseResponse> {
  const url = `/api/browse?path=${encodeURIComponent(path)}`;
  const res = await authedFetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getConfig(): Promise<NeigeConfig> {
  const res = await authedFetch('/api/config');
  if (!res.ok) return {};
  try {
    return (await res.json()) as NeigeConfig;
  } catch {
    return {};
  }
}

export async function saveConfig(cfg: NeigeConfig): Promise<void> {
  await authedFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
}

export interface IsGitRepoResponse {
  is_git_repo: boolean;
}

export async function isGitRepo(path: string): Promise<boolean> {
  const res = await authedFetch(`/api/is-git-repo?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as IsGitRepoResponse;
  return !!data.is_git_repo;
}

export interface FileSearchEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function searchFiles(
  path: string,
  query?: string,
): Promise<FileSearchEntry[]> {
  const url = `/api/files?path=${encodeURIComponent(path)}${
    query ? `&query=${encodeURIComponent(query)}` : ''
  }`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function fileUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

export async function saveLayout(layout: unknown): Promise<void> {
  await authedFetch('/api/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
}

export async function loadLayout(): Promise<unknown | null> {
  const res = await authedFetch('/api/layout');
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
