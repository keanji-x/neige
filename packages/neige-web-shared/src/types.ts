/** Backend session mode. Terminal = PTY/xterm; Chat = headless stream-json. */
export type SessionMode = 'terminal' | 'chat';

export interface ConvInfo {
  id: string;
  title: string;
  status: 'running' | 'detached' | 'dead';
  mode: SessionMode;
  program: string;
  cwd: string;
  /** Actual working directory (worktree path if applicable) */
  effective_cwd: string;
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
  worktree_name?: string;
  /** Defaults to 'terminal' on the server if omitted. */
  mode?: SessionMode;
}

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

export interface BrowseResponse {
  path: string;
  entries: DirEntry[];
  is_git_repo: boolean;
}

export interface NeigeConfig {
  proxy?: string;
  [key: string]: unknown;
}
