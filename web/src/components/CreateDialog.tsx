import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateConvRequest, DirEntry } from '../types';
import type { NeigeConfig } from '../hooks/useConfig';

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
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setProgram('claude');
      setCustomProgram('');
      setCwd('');
      setProxy(config.proxy || '');
      setEntries([]);
      setShowBrowser(false);
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open]);

  const browse = useCallback(async (path: string) => {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
    if (res.ok) {
      const data = await res.json();
      setCwd(data.path);
      setEntries(data.entries);
      setShowBrowser(true);
    }
  }, []);

  const handleSubmit = () => {
    const effectiveTitle =
      title.trim() ||
      cwd.split('/').filter(Boolean).pop() ||
      'untitled';
    const effectiveProgram =
      program === '__custom__' ? customProgram.trim() || 'claude' : program;
    const proxyVal = proxy.trim();
    if (proxyVal !== (config.proxy || '')) {
      onConfigUpdate({ proxy: proxyVal || undefined });
    }
    onCreate({
      title: effectiveTitle,
      program: effectiveProgram,
      cwd: cwd.trim() || '',
      proxy: proxyVal || undefined,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
    if (e.key === 'Escape') onClose();
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

        <label className="field-label">Working Directory</label>
        <div className="path-input-row">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="Default: server working directory"
          />
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
