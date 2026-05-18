// Calm UI types — Cove (project) / Wave (task) / Today (home).
// Mirrors the design's seed data shape; renamed Sea → Cove.

export type WaveStatus = 'running' | 'waiting';

export interface Cove {
  id: string;
  name: string;
  subtitle: string;
  color: string;
}

export type TermLineKind =
  | 'log'
  | 'cmd'
  | 'out'
  | 'edit'
  | 'err'
  | 'me'
  | 'ask'
  | 'hint'
  | 'pass'
  | 'fail';

export interface TermLine {
  kind: TermLineKind;
  text: string;
}

export interface TerminalCardData {
  type: 'terminal';
  title: string;
  lines: TermLine[];
  // Optional pointer at a kernel Terminal row (calm-server's
  // `Terminal.id`). When set, the card hosts a live xterm/PTY rather than
  // rendering the static `lines`.
  terminalId?: string;
}

export interface DocCardData {
  type: 'doc';
  title: string;
  body: string;
}

export interface GitCommit {
  sha: string;
  msg: string;
  when: string;
}

export interface GitCardData {
  type: 'git';
  branch: string;
  commits: GitCommit[];
}

export type DiffLineKind = 'ctx' | 'add' | 'rm';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffCardData {
  type: 'diff';
  file: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

export interface PlanStep {
  label: string;
  done?: boolean;
  cur?: boolean;
  when?: string;
}

export interface PlanCardData {
  type: 'plan';
  steps: PlanStep[];
}

export type WaveCardData =
  | TerminalCardData
  | DocCardData
  | GitCardData
  | DiffCardData
  | PlanCardData;

export interface Wave {
  id: string;
  coveId: string;
  title: string;
  status: WaveStatus;
  progress: number;
  eta: string;
  now: string;
  plan?: PlanStep[];
  cards?: WaveCardData[];
}

export type Route =
  | { name: 'today' }
  | { name: 'cove'; coveId: string }
  | { name: 'wave'; id: string };
