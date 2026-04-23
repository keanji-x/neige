import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, Dialog, DialogContent } from '@neige/shared';
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
      // Title focus is handled via DialogContent#onOpenAutoFocus below, which
      // fires after Radix has installed its focus trap — avoids racing with it.
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

  // Autocomplete: fetch parent dir and filter by prefix
  const autocomplete = useCallback(async (input: string) => {
    if (!input || input.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Split into parent dir + prefix
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
    const newPath = `${parentPath}/${name}`;
    setCwd(newPath);
    setShowSuggestions(false);
    setSuggestions([]);
    // Continue autocomplete from new path
    cwdInputRef.current?.focus();
  };

  const handleCwdKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      // Tab to autocomplete: trigger browse of current input
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
          'Worktree name can only contain letters, digits, dots, underscores, and hyphens.'
        );
        return;
      }
    }

    if (useWorktree && isClaudeProgram) {
      try {
        const ok = await isGitRepo(trimmedCwd);
        if (!ok) {
          setWorktreeError(
            'This directory is not in a git repo — worktree is unavailable. Uncheck the box or choose a git directory.'
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

  // Breadcrumb segments from cwd
  const cwdSegments = cwd
    ? cwd.split('/').filter(Boolean)
    : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          // Escape while autocomplete is open dismisses just the dropdown,
          // matching pre-Radix behavior. Otherwise Radix closes the dialog.
          if (showSuggestions) {
            e.preventDefault();
            setShowSuggestions(false);
          }
        }}
      >
      <div className="w-full" onKeyDown={handleKeyDown}>
        <h2 className="m-0 mb-5 text-lg font-semibold tracking-[-0.01em]">New Conversation</h2>

        {(config.recentCommands?.length ?? 0) > 0 && (
          <div className="mb-4">
            <label className="block text-xs text-text-muted mb-1.5 font-medium tracking-[0.03em]">
              Recent
            </label>
            <div className="flex flex-wrap gap-1.5">
              {config.recentCommands!.map((cmd: RecentCommand, i: number) => (
                <button
                  key={i}
                  className="flex items-center gap-1.5 px-2.5 py-[5px] bg-bg-primary border border-border rounded-md text-text-secondary text-xs font-sans cursor-pointer transition-colors max-w-full hover:bg-bg-hover hover:border-blue hover:text-text-primary"
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
                  <span className="font-mono text-xs text-text-faint whitespace-nowrap overflow-hidden text-ellipsis">
                    {cmd.cwd ? cmd.cwd.replace(/^\/home\/[^/]+/, '~') : 'default'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block text-xs text-text-muted mb-1.5 font-medium tracking-[0.03em]">Title</label>
        <input
          ref={titleRef}
          className="w-full px-3 py-[9px] bg-bg-primary border border-border rounded-md text-text-primary text-base font-sans mb-4 outline-none transition-colors focus:border-blue focus:shadow-[0_0_0_3px_rgba(56,139,253,0.15)] placeholder:text-text-faint"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={cwd ? cwd.split('/').filter(Boolean).pop() || '' : 'Auto from directory name'}
        />

        <label className="block text-xs text-text-muted mb-1.5 font-medium tracking-[0.03em]">Program</label>
        <div className="flex gap-2 mb-4">
          <select
            className="program-select flex-1 px-3 py-[9px] bg-bg-primary border border-border rounded-md text-text-primary text-base font-sans outline-none cursor-pointer transition-colors appearance-none pr-8 focus:border-blue focus:shadow-[0_0_0_3px_rgba(56,139,253,0.15)]"
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
            <input
              className="flex-1 px-3 py-[9px] bg-bg-primary border border-border rounded-md text-text-primary text-base font-mono outline-none transition-colors focus:border-blue focus:shadow-[0_0_0_3px_rgba(56,139,253,0.15)]"
              value={customProgram}
              onChange={(e) => setCustomProgram(e.target.value)}
              placeholder="Enter program name"
              autoFocus
            />
          )}
        </div>

        <label className="block text-xs text-text-muted mb-1.5 font-medium tracking-[0.03em]">Proxy</label>
        <input
          className="w-full px-3 py-[9px] bg-bg-primary border border-border rounded-md text-text-primary text-base font-sans mb-4 outline-none transition-colors focus:border-blue focus:shadow-[0_0_0_3px_rgba(56,139,253,0.15)] placeholder:text-text-faint"
          value={proxy}
          onChange={(e) => setProxy(e.target.value)}
          placeholder="e.g. http://127.0.0.1:7890"
        />

        {isClaudeProgram && (
          <>
            <label className="flex items-center gap-2 mb-4 cursor-pointer text-xs text-text-muted font-medium tracking-[0.03em]">
              <input
                type="checkbox"
                className="w-auto m-0 p-0 cursor-pointer accent-blue"
                checked={useWorktree}
                onChange={(e) => {
                  setUseWorktree(e.target.checked);
                  setWorktreeError('');
                }}
              />
              <span className="text-sm text-text-primary">Use git worktree</span>
              <span className="text-xs text-text-faint font-normal">Each session gets its own branch</span>
            </label>
            {useWorktree && (
              <input
                className="w-full px-3 py-[9px] bg-bg-primary border border-border rounded-md text-text-primary text-base font-sans mb-4 outline-none transition-colors focus:border-blue focus:shadow-[0_0_0_3px_rgba(56,139,253,0.15)] placeholder:text-text-faint"
                value={worktreeName}
                onChange={(e) => {
                  setWorktreeName(e.target.value);
                  setWorktreeError('');
                }}
                placeholder="Worktree name (optional, e.g. fix-login)"
              />
            )}
            {worktreeError && (
              <div className="text-xs text-red -mt-2 mb-3 px-2.5 py-1.5 bg-red-dim border-l-2 border-red rounded-[2px]">
                {worktreeError}
              </div>
            )}
          </>
        )}

        <label className="block text-xs text-text-muted mb-1.5 font-medium tracking-[0.03em]">
          Working Directory
        </label>
        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <input
              ref={cwdInputRef}
              className="w-full px-3 py-[9px] bg-bg-primary border border-border rounded-md text-text-primary text-base font-sans outline-none transition-colors focus:border-blue focus:shadow-[0_0_0_3px_rgba(56,139,253,0.15)] placeholder:text-text-faint"
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
                    className={clsx(
                      'flex items-center gap-1.5 w-full px-3 py-1.5 bg-transparent border-none border-b border-border last:border-b-0 text-text-secondary text-sm font-mono cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary',
                      i === selectedSuggestion && 'bg-blue-dim text-text-primary',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySuggestion(s.name);
                    }}
                  >
                    <span className="mr-1.5 text-sm">&#128193;</span>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="bg-bg-tertiary border border-border text-text-secondary px-3 py-2 rounded-md cursor-pointer text-sm font-sans whitespace-nowrap transition-colors hover:bg-bg-active hover:border-border-light"
            onClick={() => browse(cwd || '~')}
            type="button"
          >
            Browse
          </button>
        </div>

        {showBrowser && (
          <>
            {cwdSegments.length > 0 && (
              <div className="dir-breadcrumb flex flex-wrap items-center gap-0.5 mb-2 text-xs font-mono">
                <button
                  className="bg-bg-tertiary border-none text-text-muted px-1.5 py-0.5 rounded cursor-pointer font-mono text-xs transition-colors hover:bg-bg-hover hover:text-blue"
                  onClick={() => browse('/')}
                >
                  /
                </button>
                {cwdSegments.map((seg, i) => (
                  <button
                    key={i}
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
            <div className="bg-bg-primary border border-border rounded-md max-h-[180px] overflow-y-auto mb-4">
              <button
                className="block w-full px-3 py-[7px] bg-transparent border-none border-b border-border last:border-b-0 text-text-muted text-sm font-mono cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary"
                onClick={() => {
                  const parent = cwd.replace(/\/[^/]+\/?$/, '') || '/';
                  browse(parent);
                }}
              >
                <span className="mr-1.5 text-sm">&#8617;</span>
                ..
              </button>
              {entries
                .filter((e) => e.is_dir)
                .map((entry) => (
                  <button
                    key={entry.name}
                    className="block w-full px-3 py-[7px] bg-transparent border-none border-b border-border last:border-b-0 text-text-secondary text-sm font-mono cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary"
                    onClick={() => {
                      const next = cwd.endsWith('/')
                        ? `${cwd}${entry.name}`
                        : `${cwd}/${entry.name}`;
                      browse(next);
                    }}
                  >
                    <span className="mr-1.5 text-sm">&#128193;</span>
                    {entry.name}
                  </button>
                ))}
            </div>
          </>
        )}

        <div className="flex gap-2 items-center justify-end mt-3">
          <div className="mr-auto text-xs text-text-faint flex items-center gap-[3px]">
            <kbd className="inline-block px-1.5 py-px bg-bg-tertiary border border-border rounded-[3px] font-mono text-[10px] text-text-muted leading-[1.4]">⌘</kbd>
            +
            <kbd className="inline-block px-1.5 py-px bg-bg-tertiary border border-border rounded-[3px] font-mono text-[10px] text-text-muted leading-[1.4]">Enter</kbd>
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
