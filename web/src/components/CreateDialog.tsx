import { useCallback, useEffect, useRef, useState } from 'react';
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
      setTimeout(() => titleRef.current?.focus(), 50);
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
    if (e.key === 'Escape' && !showSuggestions) onClose();
  };

  if (!open) return null;

  // Breadcrumb segments from cwd
  const cwdSegments = cwd
    ? cwd.split('/').filter(Boolean)
    : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2>New Conversation</h2>

        {(config.recentCommands?.length ?? 0) > 0 && (
          <div className="recent-commands">
            <label className="field-label">Recent</label>
            <div className="recent-commands-list">
              {config.recentCommands!.map((cmd: RecentCommand, i: number) => (
                <button
                  key={i}
                  className="recent-command-item"
                  onClick={() => {
                    setTitle(cmd.title || '');
                    setProgram(PROGRAMS.includes(cmd.program) ? cmd.program : '__custom__');
                    if (!PROGRAMS.includes(cmd.program)) setCustomProgram(cmd.program);
                    setCwd(cmd.cwd);
                    setUseWorktree(cmd.use_worktree);
                    setWorktreeError('');
                  }}
                >
                  <span className="recent-command-program">{cmd.program}</span>
                  <span className="recent-command-path">{cmd.cwd ? cmd.cwd.replace(/^\/home\/[^/]+/, '~') : 'default'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="field-label">Title</label>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={cwd ? cwd.split('/').filter(Boolean).pop() || '' : 'Auto from directory name'}
        />

        <label className="field-label">Program</label>
        <div className="program-row">
          <select
            className="program-select"
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
              className="program-custom-input"
              value={customProgram}
              onChange={(e) => setCustomProgram(e.target.value)}
              placeholder="Enter program name"
              autoFocus
            />
          )}
        </div>

        <label className="field-label">Proxy</label>
        <input
          value={proxy}
          onChange={(e) => setProxy(e.target.value)}
          placeholder="e.g. http://127.0.0.1:7890"
        />

        {isClaudeProgram && (
          <>
            <label className="field-label checkbox-label">
              <input
                type="checkbox"
                checked={useWorktree}
                onChange={(e) => {
                  setUseWorktree(e.target.checked);
                  setWorktreeError('');
                }}
              />
              <span>Use git worktree</span>
              <span className="field-hint">Each session gets its own branch</span>
            </label>
            {useWorktree && (
              <input
                value={worktreeName}
                onChange={(e) => {
                  setWorktreeName(e.target.value);
                  setWorktreeError('');
                }}
                placeholder="Worktree name (optional, e.g. fix-login)"
              />
            )}
            {worktreeError && (
              <div className="field-error">{worktreeError}</div>
            )}
          </>
        )}

        <label className="field-label">Working Directory</label>
        <div className="path-input-row">
          <div className="path-input-wrapper">
            <input
              ref={cwdInputRef}
              value={cwd}
              onChange={(e) => handleCwdChange(e.target.value)}
              onKeyDown={handleCwdKeyDown}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Type to autocomplete, Tab to browse"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="path-suggestions">
                {suggestions.map((s, i) => (
                  <button
                    key={s.name}
                    className={`path-suggestion ${i === selectedSuggestion ? 'selected' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySuggestion(s.name);
                    }}
                  >
                    <span className="dir-entry-icon">&#128193;</span>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn-browse"
            onClick={() => browse(cwd || '~')}
            type="button"
          >
            Browse
          </button>
        </div>

        {showBrowser && (
          <>
            {cwdSegments.length > 0 && (
              <div className="dir-breadcrumb">
                <button
                  className="breadcrumb-seg breadcrumb-root"
                  onClick={() => browse('/')}
                >
                  /
                </button>
                {cwdSegments.map((seg, i) => (
                  <button
                    key={i}
                    className={`breadcrumb-seg ${i === cwdSegments.length - 1 ? 'breadcrumb-current' : ''}`}
                    onClick={() => browse('/' + cwdSegments.slice(0, i + 1).join('/'))}
                  >
                    {seg}
                  </button>
                ))}
              </div>
            )}
            <div className="dir-browser">
              <button
                className="dir-entry dir-parent"
                onClick={() => {
                  const parent = cwd.replace(/\/[^/]+\/?$/, '') || '/';
                  browse(parent);
                }}
              >
                <span className="dir-entry-icon">&#8617;</span>
                ..
              </button>
              {entries
                .filter((e) => e.is_dir)
                .map((entry) => (
                  <button
                    key={entry.name}
                    className="dir-entry"
                    onClick={() => {
                      const next = cwd.endsWith('/')
                        ? `${cwd}${entry.name}`
                        : `${cwd}/${entry.name}`;
                      browse(next);
                    }}
                  >
                    <span className="dir-entry-icon">&#128193;</span>
                    {entry.name}
                  </button>
                ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          <div className="modal-hint">
            <kbd>⌘</kbd> + <kbd>Enter</kbd> to create
          </div>
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-create" onClick={handleSubmit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
