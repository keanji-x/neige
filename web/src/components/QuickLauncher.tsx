import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
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
    const el = document.querySelector('[data-launcher-selected="true"]');
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
      <div
        className="flex flex-col w-full max-h-[420px] overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center px-4 py-3 border-b border-border gap-2">
          <span className="text-base flex-shrink-0 opacity-50">{'\u{26A1}'}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Switch session or launch recent command..."
            className="flex-1 bg-transparent border-none text-text-primary text-[15px] font-sans outline-none placeholder:text-text-faint"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-6 py-6 text-center text-text-faint text-sm">
              {query ? 'No matches' : 'No sessions or recent commands'}
            </div>
          )}
          {hasSessions && (
            <div className="px-4 pt-1.5 pb-0.5 text-[10px] font-semibold text-text-faint uppercase tracking-[0.06em] select-none">
              Active sessions
            </div>
          )}
          {items.filter((i) => i.type === 'session').map((item) => {
            const idx = globalIdx++;
            const s = item.session!;
            const isSelected = idx === selected;
            return (
              <button
                key={`s:${s.id}`}
                data-launcher-selected={isSelected ? 'true' : undefined}
                className={clsx(
                  'flex items-center gap-2 w-full px-4 py-2 bg-transparent border-none text-text-secondary text-sm font-sans cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary',
                  isSelected && 'bg-blue-dim text-text-primary',
                )}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelected(idx)}
              >
                <span
                  className={clsx(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    s.status === 'running' && 'bg-status-running shadow-[0_0_6px_rgba(63,185,80,0.5)]',
                    s.status === 'detached' && 'bg-yellow shadow-[0_0_6px_rgba(210,153,34,0.5)]',
                    s.status === 'dead' && 'bg-text-faint',
                  )}
                />
                <span className="font-medium whitespace-nowrap">{item.label}</span>
                <span className="font-mono text-xs text-text-faint ml-auto whitespace-nowrap overflow-hidden text-ellipsis max-w-[280px] text-right">
                  {item.detail}
                </span>
              </button>
            );
          })}
          {hasRecent && (
            <div className="px-4 pt-1.5 pb-0.5 text-[10px] font-semibold text-text-faint uppercase tracking-[0.06em] select-none">
              Launch new
            </div>
          )}
          {items.filter((i) => i.type === 'recent').map((item, i) => {
            const idx = globalIdx++;
            const isSelected = idx === selected;
            return (
              <button
                key={`r:${i}`}
                data-launcher-selected={isSelected ? 'true' : undefined}
                className={clsx(
                  'flex items-center gap-2 w-full px-4 py-2 bg-transparent border-none text-text-secondary text-sm font-sans cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary',
                  isSelected && 'bg-blue-dim text-text-primary',
                )}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelected(idx)}
              >
                <span className="text-sm flex-shrink-0">{'\u{1F680}'}</span>
                <span className="font-medium whitespace-nowrap">{item.label}</span>
                <span className="font-mono text-xs text-text-faint ml-auto whitespace-nowrap overflow-hidden text-ellipsis max-w-[280px] text-right">
                  {item.detail}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
