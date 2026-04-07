export interface ConvInfo {
  id: string;
  title: string;
  status: 'running' | 'detached' | 'dead';
  program: string;
  cwd: string;
  created_at: string;
  use_worktree: boolean;
  worktree_branch: string | null;
}

export interface CreateConvRequest {
  title: string;
  program: string;
  cwd: string;
  proxy?: string;
  use_worktree: boolean;
}

export interface DirEntry {
  name: string;
  is_dir: boolean;
}
