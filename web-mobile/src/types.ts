export interface DirEntry {
  name: string
  is_dir: boolean
}

export interface BrowseResponse {
  path: string
  entries: DirEntry[]
  is_git_repo: boolean
}

export interface CreateConvRequest {
  title: string
  program: string
  cwd: string
  use_worktree: boolean
  worktree_name?: string
  proxy?: string
}

export interface ConvInfo {
  id: string
  title: string
  status: 'running' | 'detached' | 'dead'
  program: string
  cwd: string
  effective_cwd: string
  created_at: string
  use_worktree: boolean
  worktree_branch: string | null
}
