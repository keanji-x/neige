export interface ConvInfo {
  id: string;
  title: string;
  status: 'running' | 'dead';
  program: string;
  cwd: string;
  created_at: string;
}

export interface CreateConvRequest {
  title: string;
  program: string;
  cwd: string;
  proxy?: string;
}

export interface DirEntry {
  name: string;
  is_dir: boolean;
}
