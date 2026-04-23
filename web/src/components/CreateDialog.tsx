import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, Dialog, DialogContent, Field, Input } from '@neige/shared';
import type { CreateConvRequest, DirEntry } from '../types';
import { browseDir, isGitRepo } from '../api';
import type { NeigeConfig, RecentCommand } from '../hooks/useConfig';

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (req: CreateConvRequest) => void;
  config: NeigeConfig;
  onConfigUpdate: (patch: Partial<NeigeConfig>) => void;
}

const PROGRAMS = ['claude', 'bash', 'zsh', 'python3', 'node'];

// Shared styling for the program-select element. Keeps the chevron SVG (set
// via `.program-select` in App.css) while matching Input's look elsewhere.
const SELECT_CLASS =
  'program-select flex-1 h-9 px-3 pr-8 rounded-md border border-border bg-bg-primary ' +
  'text-text-primary text-sm font-sans outline-none cursor-pointer transition-colors ' +
  'focus:border-blue focus:shadow-[0_0_0_3px_rgba(56,139,253,0.15)]';

export function CreateDialog({ open, onClose, onCreate, config, onConfigUpdate }: CreateDialogProps) {
  const [title, setTitle] = useState('');
  const [program, setProgram] = useState('claude');
  const [customProgram, setCustomProgram] = useState('');
  const [cwd, setCwd] = useState('');
  const [proxy, setProxy] = useState('');
  const [useWorktree, setUseWorktree] = useState(true);
  const [worktreeName, setWorktreeName] = useState('');
  const [worktreeError, setWorktreeError] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  // Autocomplete state
  const [suggestions, setSuggestions] = useState<DirEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const autocompleteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cwdInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setProgram('claude');
      setCustomProgram('');
      setCwd('');
      setProxy(config.proxy || '');
      setUseWorktree(true);
      setWorktreeName('');
      setWorktreeError('');
      setEntries([]);
      setShowBrowser(false);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [open, config.proxy]);

  const browse = useCallback(async (path: string) => {
    try {
      const data = await browseDir(path);
      setCwd(data.path);
      setEntries(data.entries);
      setShowBrowser(true);
      setShowSuggestions(false);
      setWorktreeError('');
    } catch {
      // ignore — caller stays on current view
    }
  }, []);

  const autocomplete = useCallback(async (input: string) => {
    if (!input || input.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const lastSlash = input.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? input.substring(0, lastSlash) || '/' : '';
    const prefix = lastSlash >= 0 ? input.substring(lastSlash + 1).toLowerCase() : input.toLowerCase();
    if (!parentPath) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const data = await browseDir(parentPath);
      const filtered = data.entries
        .filter((e) => e.is_dir && e.name.toLowerCase().startsWith(prefix))
        .slice(0, 8);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedSuggestion(-1);
    } catch {
      // ignore
    }
  }, []);

  const handleCwdChange = (value: string) => {
    setCwd(value);
    setShowBrowser(false);
    clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(() => autocomplete(value), 200);
  };

  const applySuggestion = (name: string) => {
    const lastSlash = cwd.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? cwd.substring(0, lastSlash) : '';
    setCwd(`${parentPath}/${name}`);
    setShowSuggestions(false);
    setSuggestions([]);
    cwdInputRef.current?.focus();
  };

  const handleCwdKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Tab' && cwd) {
        e.preventDefault();
        browse(cwd);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestion((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (selectedSuggestion >= 0) {
        e.preventDefault();
        applySuggestion(suggestions[selectedSuggestion].name);
      } else if (suggestions.length === 1) {
        e.preventDefault();
        applySuggestion(suggestions[0].name);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const effectiveProgram =
    program === '__custom__' ? customProgram.trim() || 'claude' : program;
  const isClaudeProgram =
    effectiveProgram === 'claude' || effectiveProgram.startsWith('claude ');

  const handleSubmit = async () => {
    const effectiveTitle =
      title.trim() ||
      cwd.split('/').filter(Boolean).pop() ||
      'untitled';
    const trimmedCwd = cwd.trim();
    const trimmedWorktreeName = worktreeName.trim();

    if (useWorktree && isClaudeProgram && trimmedWorktreeName) {
      if (!/^[A-Za-z0-9._-]+$/.test(trimmedWorktreeName)) {
        setWorktreeError(
          'Worktree name can only contain letters, digits, dots, underscores, and hyphens.',
        );
        return;
      }
    }

    if (useWorktree && isClaudeProgram) {
      try {
        const ok = await isGitRepo(trimmedCwd);
        if (!ok) {
          setWorktreeError(
            'This directory is not in a git repo — worktree is unavailable. Uncheck the box or choose a git directory.',
          );
          return;
        }
      } catch {
        // If the check fails, fall through and let backend handle it.
      }
    }

    const proxyVal = proxy.trim();
    if (proxyVal !== (config.proxy || '')) {
      onConfigUpdate({ proxy: proxyVal || undefined });
    }
    onCreate({
      title: effectiveTitle,
      program: effectiveProgram,
      cwd: trimmedCwd,
      proxy: proxyVal || undefined,
      use_worktree: useWorktree,
      worktree_name: useWorktree && trimmedWorktreeName ? trimmedWorktreeName : undefined,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  const cwdSegments = cwd ? cwd.split('/').filter(Boolean) : [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (showSuggestions) {
            e.preventDefault();
            setShowSuggestions(false);
          }
        }}
      >
        <div onKeyDown={handleKeyDown}>
          <h2 className="m-0 mb-5 text-xl font-semibold tracking-[-0.01em]">
            New Conversation
          </h2>

          {/* Field-to-field spacing: 20 px (space-y-5). Inside Field, label→
              input is 6 px. Section dividers (before Worktree group, before
              footer) use their own larger gaps to create hierarchy. */}
          <div className="space-y-5">
            {(config.recentCommands?.length ?? 0) > 0 && (
              <Field label="Recent">
                <div className="flex flex-wrap gap-1.5">
                  {config.recentCommands!.map((cmd: RecentCommand, i: number) => (
                    <button
                      key={i}
                      type="button"
                      className={
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border ' +
                        'bg-bg-primary text-text-secondary text-xs font-sans cursor-pointer transition-colors max-w-full ' +
                        'hover:bg-bg-hover hover:border-blue hover:text-text-primary'
                      }
                      onClick={() => {
                        setTitle(cmd.title || '');
                        setProgram(PROGRAMS.includes(cmd.program) ? cmd.program : '__custom__');
                        if (!PROGRAMS.includes(cmd.program)) setCustomProgram(cmd.program);
                        setCwd(cmd.cwd);
                        setUseWorktree(cmd.use_worktree);
                        setWorktreeError('');
                      }}
                    >
                      <span className="font-medium text-blue flex-shrink-0">{cmd.program}</span>
                      <span className="font-mono text-text-faint whitespace-nowrap overflow-hidden text-ellipsis">
                        {cmd.cwd ? cmd.cwd.replace(/^\/home\/[^/]+/, '~') : 'default'}
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Title">
              <Input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={cwd ? cwd.split('/').filter(Boolean).pop() || '' : 'Auto from directory name'}
              />
            </Field>

            <Field label="Program">
              <div className="flex gap-2">
                <select
                  className={SELECT_CLASS}
                  value={PROGRAMS.includes(program) ? program : '__custom__'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setProgram(val);
                    if (val !== '__custom__') setCustomProgram('');
                  }}
                >
                  {PROGRAMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                  <option value="__custom__">Custom...</option>
                </select>
                {program === '__custom__' && (
                  <Input
                    className="flex-1 font-mono"
                    value={customProgram}
                    onChange={(e) => setCustomProgram(e.target.value)}
                    placeholder="Enter program name"
                    autoFocus
                  />
                )}
              </div>
            </Field>

            <Field label="Proxy" hint="optional">
              <Input
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                placeholder="e.g. http://127.0.0.1:7890"
              />
            </Field>

            {isClaudeProgram && (
              <div className="space-y-3 rounded-md border border-border bg-bg-primary/40 p-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-blue cursor-pointer"
                    checked={useWorktree}
                    onChange={(e) => {
                      setUseWorktree(e.target.checked);
                      setWorktreeError('');
                    }}
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-text-primary">
                      Use git worktree
                    </span>
                    <span className="block text-xs text-text-muted mt-0.5">
                      Each session gets its own branch
                    </span>
                  </span>
                </label>
                {useWorktree && (
                  <Input
                    className="font-mono"
                    value={worktreeName}
                    onChange={(e) => {
                      setWorktreeName(e.target.value);
                      setWorktreeError('');
                    }}
                    placeholder="Worktree name (optional, e.g. fix-login)"
                  />
                )}
                {worktreeError && (
                  <p className="text-xs text-red bg-red-dim px-2.5 py-1.5 border-l-2 border-red rounded-[2px]">
                    {worktreeError}
                  </p>
                )}
              </div>
            )}

            <Field label="Working Directory">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Input
                    ref={cwdInputRef}
                    className="font-mono"
                    value={cwd}
                    onChange={(e) => handleCwdChange(e.target.value)}
                    onKeyDown={handleCwdKeyDown}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    placeholder="Type to autocomplete, Tab to browse"
                  />
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-bg-primary border border-border-light border-t-0 rounded-b-md max-h-[200px] overflow-y-auto z-10 shadow-md">
                      {suggestions.map((s, i) => (
                        <button
                          key={s.name}
                          type="button"
                          className={clsx(
                            'flex items-center gap-1.5 w-full px-3 py-1.5 bg-transparent border-b border-border last:border-b-0',
                            'text-text-secondary text-sm font-mono cursor-pointer text-left transition-colors',
                            'hover:bg-bg-hover hover:text-text-primary',
                            i === selectedSuggestion && 'bg-blue-dim text-text-primary',
                          )}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applySuggestion(s.name);
                          }}
                        >
                          <span className="text-sm">&#128193;</span>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant="default"
                  size="md"
                  onClick={() => browse(cwd || '~')}
                  type="button"
                >
                  Browse
                </Button>
              </div>
            </Field>

            {showBrowser && (
              <div className="-mt-2">
                {cwdSegments.length > 0 && (
                  <div className="dir-breadcrumb flex flex-wrap items-center gap-0.5 mb-2 text-xs font-mono">
                    <button
                      type="button"
                      className="bg-bg-tertiary border-none text-text-muted px-1.5 py-0.5 rounded cursor-pointer font-mono text-xs transition-colors hover:bg-bg-hover hover:text-blue"
                      onClick={() => browse('/')}
                    >
                      /
                    </button>
                    {cwdSegments.map((seg, i) => (
                      <button
                        key={i}
                        type="button"
                        className={clsx(
                          'breadcrumb-seg bg-bg-tertiary border-none text-text-muted px-1.5 py-0.5 rounded cursor-pointer font-mono text-xs transition-colors hover:bg-bg-hover hover:text-blue',
                          i === cwdSegments.length - 1 && 'text-text-primary font-medium',
                        )}
                        onClick={() => browse('/' + cwdSegments.slice(0, i + 1).join('/'))}
                      >
                        {seg}
                      </button>
                    ))}
                  </div>
                )}
                <div className="bg-bg-primary border border-border rounded-md max-h-[180px] overflow-y-auto">
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 bg-transparent border-b border-border text-text-muted text-sm font-mono cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary"
                    onClick={() => {
                      const parent = cwd.replace(/\/[^/]+\/?$/, '') || '/';
                      browse(parent);
                    }}
                  >
                    <span className="mr-1.5">&#8617;</span>
                    ..
                  </button>
                  {entries
                    .filter((e) => e.is_dir)
                    .map((entry) => (
                      <button
                        key={entry.name}
                        type="button"
                        className="block w-full px-3 py-1.5 bg-transparent border-b border-border last:border-b-0 text-text-secondary text-sm font-mono cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary"
                        onClick={() => {
                          const next = cwd.endsWith('/')
                            ? `${cwd}${entry.name}`
                            : `${cwd}/${entry.name}`;
                          browse(next);
                        }}
                      >
                        <span className="mr-1.5">&#128193;</span>
                        {entry.name}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer: separated by 24 px (mt-6) + top border for visual break */}
          <div className="flex gap-2 items-center justify-end mt-6 pt-4 border-t border-border">
            <div className="mr-auto text-xs text-text-faint flex items-center gap-1">
              <kbd className="inline-block px-1.5 py-px bg-bg-tertiary border border-border rounded text-[11px] font-mono text-text-muted">
                ⌘
              </kbd>
              +
              <kbd className="inline-block px-1.5 py-px bg-bg-tertiary border border-border rounded text-[11px] font-mono text-text-muted">
                Enter
              </kbd>
              to create
            </div>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit}>
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
