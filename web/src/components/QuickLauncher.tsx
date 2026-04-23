import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent } from '@neige/shared';
import type { RecentCommand } from '../hooks/useConfig';
import type { ConvInfo } from '../types';

interface QuickLauncherProps {
  open: boolean;
  onClose: () => void;
  onLaunch: (cmd: RecentCommand) => void;
  onSelect: (id: string) => void;
  recentCommands: RecentCommand[];
  conversations: ConvInfo[];
}

export function QuickLauncher({
  open,
  onClose,
  onLaunch,
  onSelect,
  recentCommands,
  conversations,
}: QuickLauncherProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
    }
  }, [open]);

  const lq = query.toLowerCase();

  // Running/detached sessions
  const activeSessions = conversations
    .filter((c) => c.status !== 'dead')
    .filter((c) => !lq || c.title.toLowerCase().includes(lq) || c.cwd.toLowerCase().includes(lq) || c.program.toLowerCase().includes(lq));

  // Recent commands (for launching new)
  const filteredRecent = recentCommands.filter(
    (cmd) => !lq || cmd.program.toLowerCase().includes(lq) || cmd.cwd.toLowerCase().includes(lq) || (cmd.title && cmd.title.toLowerCase().includes(lq)),
  );

  interface DisplayItem {
    type: 'session' | 'recent';
    session?: ConvInfo;
    command?: RecentCommand;
    label: string;
    detail: string;
  }

  const items: DisplayItem[] = [];

  for (const s of activeSessions) {
    items.push({
      type: 'session',
      session: s,
      label: s.title,
      detail: `${s.program} — ${s.cwd.replace(/^\/home\/[^/]+/, '~')}`,
    });
  }

  for (const cmd of filteredRecent) {
    items.push({
      type: 'recent',
      command: cmd,
      label: cmd.title || cmd.program,
      detail: `${cmd.program} — ${cmd.cwd ? cmd.cwd.replace(/^\/home\/[^/]+/, '~') : 'default'}`,
    });
  }

  const handleSelect = (item: DisplayItem) => {
    if (item.type === 'session' && item.session) {
      onSelect(item.session.id);
    } else if (item.type === 'recent' && item.command) {
      onLaunch(item.command);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && items.length > 0) {
      e.preventDefault();
      handleSelect(items[selected]);
    }
    // Escape handled by Radix Dialog via onOpenChange
  };

  useEffect(() => {
    const el = document.querySelector('.quick-launcher-item.selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const hasSessions = items.some((i) => i.type === 'session');
  const hasRecent = items.some((i) => i.type === 'recent');
  let globalIdx = 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
      <div className="file-picker" onKeyDown={handleKeyDown}>
        <div className="file-picker-input-row">
          <span className="file-picker-icon">{'\u{26A1}'}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Switch session or launch recent command..."
            className="file-picker-input"
          />
        </div>
        <div className="file-picker-results">
          {items.length === 0 && (
            <div className="file-picker-empty">
              {query ? 'No matches' : 'No sessions or recent commands'}
            </div>
          )}
          {hasSessions && (
            <div className="file-picker-section-label">Active sessions</div>
          )}
          {items.filter((i) => i.type === 'session').map((item) => {
            const idx = globalIdx++;
            const s = item.session!;
            return (
              <button
                key={`s:${s.id}`}
                className={`file-picker-item ${idx === selected ? 'selected' : ''}`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelected(idx)}
              >
                <span className={`quick-launcher-dot ${s.status}`} />
                <span className="file-picker-item-name">{item.label}</span>
                <span className="file-picker-item-path">{item.detail}</span>
              </button>
            );
          })}
          {hasRecent && (
            <div className="file-picker-section-label">Launch new</div>
          )}
          {items.filter((i) => i.type === 'recent').map((item, i) => {
            const idx = globalIdx++;
            return (
              <button
                key={`r:${i}`}
                className={`file-picker-item ${idx === selected ? 'selected' : ''}`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelected(idx)}
              >
                <span className="file-picker-item-icon">{'\u{1F680}'}</span>
                <span className="file-picker-item-name">{item.label}</span>
                <span className="file-picker-item-path">{item.detail}</span>
              </button>
            );
          })}
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
