import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@neige/shared';
import type { ConvInfo } from '../types';
import { PortForwardPanel } from './PortForwardPanel';
import type { PortForward } from './PortForwardPanel';
import { useBusyTerminalIds } from '../hooks/terminalBusy';

export type { PortForward };

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface SidebarProps {
  className?: string;
  conversations: ConvInfo[];
  connected: boolean;
  openTabs: string[];
  activeTab: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onNew: () => void;
  portForwards: PortForward[];
  onPortForwardUpdate: (ports: PortForward[]) => void;
}

const COLLAPSED_WIDTH = 48;
const MIN_EXPANDED_WIDTH = 200;
const SNAP_THRESHOLD = 120;
const DEFAULT_WIDTH = 280;
const MAX_WIDTH = 480;

function InlineTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (newTitle: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [editing, value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="text-sm font-medium font-sans text-text-primary bg-bg-primary border border-blue rounded-[3px] px-[3px] py-0 outline-none w-full shadow-[0_0_0_2px_rgba(56,139,253,0.2)]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis text-text-primary cursor-default rounded-[3px] px-0.5 hover:bg-bg-hover"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="Double-click to rename"
    >
      {value}
    </span>
  );
}

export function Sidebar({
  className = '',
  conversations,
  connected,
  openTabs,
  activeTab,
  onSelect,
  onDelete,
  onRename,
  onNew,
  portForwards,
  onPortForwardUpdate,
}: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const dragging = useRef(false);
  const widthBeforeCollapse = useRef(DEFAULT_WIDTH);
  const busyIds = useBusyTerminalIds();

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      if (prev) {
        setSidebarWidth(widthBeforeCollapse.current);
        return false;
      } else {
        widthBeforeCollapse.current = sidebarWidth;
        setSidebarWidth(COLLAPSED_WIDTH);
        return true;
      }
    });
  }, [sidebarWidth]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = collapsed ? COLLAPSED_WIDTH : sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const raw = startWidth + ev.clientX - startX;

      if (raw < SNAP_THRESHOLD) {
        setSidebarWidth(COLLAPSED_WIDTH);
        setCollapsed(true);
      } else {
        const clamped = Math.min(MAX_WIDTH, Math.max(MIN_EXPANDED_WIDTH, raw));
        setSidebarWidth(clamped);
        setCollapsed(false);
        widthBeforeCollapse.current = clamped;
      }
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth, collapsed]);

  const grouped = useMemo(() => {
    const running = conversations.filter((c) => c.status === 'running');
    const detached = conversations.filter((c) => c.status === 'detached');
    const dead = conversations.filter((c) => c.status === 'dead');
    return { running, detached, dead };
  }, [conversations]);

  const renderItem = (c: ConvInfo) => {
    const isActive = activeTab === c.id;
    const isOpen = openTabs.includes(c.id);
    const isBusy = busyIds.has(c.id);
    return (
      <div
        key={c.id}
        className={clsx(
          'group px-2.5 py-2 rounded-md cursor-pointer mb-px flex items-center gap-2.5 border border-transparent transition-colors hover:bg-bg-hover',
          isActive && 'bg-blue-dim border-[rgba(56,139,253,0.4)] shadow-[inset_0_0_0_1px_rgba(56,139,253,0.1)]',
          isOpen && !isActive && 'border-l-2 border-l-blue',
          isBusy && 'opacity-45 transition-opacity duration-300',
        )}
        onClick={() => onSelect(c.id)}
      >
        <div className="flex-shrink-0 w-2.5 flex items-center justify-center">
          <span
            className={clsx(
              'w-2 h-2 rounded-full block',
              c.status === 'running' && 'bg-status-running shadow-[0_0_6px_rgba(63,185,80,0.5)] animate-pulse',
              c.status === 'detached' && 'bg-yellow shadow-[0_0_6px_rgba(210,153,34,0.5)]',
              c.status === 'dead' && 'bg-text-faint',
            )}
          />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <InlineTitle
            value={c.title}
            onSave={(newTitle) => onRename(c.id, newTitle)}
          />
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-mono text-text-muted whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
              {c.cwd}
            </span>
            {c.worktree_branch && (
              <span
                className="text-[10px] font-mono text-blue whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]"
                title={c.worktree_branch}
              >
                &#9741; {c.worktree_branch.replace('neige/', '')}
              </span>
            )}
            <span className="text-[10px] text-text-faint whitespace-nowrap flex-shrink-0">
              {timeAgo(c.created_at)}
            </span>
          </span>
        </div>
        <div className="flex gap-1.5 items-center flex-shrink-0 ml-1">
          <button
            className="bg-transparent border-none text-red cursor-pointer text-base opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:bg-red-dim transition-opacity px-1 py-0.5 leading-none rounded"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(c.id);
            }}
            title="Delete"
            aria-label="Delete conversation"
          >
            ×
          </button>
        </div>
      </div>
    );
  };

  const serverStatusClass = clsx(
    'w-2 h-2 rounded-full flex-shrink-0 transition-colors',
    connected
      ? 'bg-status-running shadow-[0_0_6px_rgba(63,185,80,0.5)]'
      : 'bg-red shadow-[0_0_6px_rgba(248,81,73,0.5)] animate-pulse',
  );

  return (
    <aside
      className={clsx(
        'bg-bg-secondary border-r border-border flex flex-col z-10 relative min-h-0 overflow-hidden transition-transform duration-300',
        className,
        collapsed && 'overflow-hidden',
      )}
      style={{ width: sidebarWidth, minWidth: COLLAPSED_WIDTH, maxWidth: 480 }}
    >
      <div
        className={clsx(
          'absolute -right-[3px] top-0 bottom-0 w-[6px] cursor-col-resize z-20 transition-colors hover:bg-blue hover:opacity-50',
          dragging.current && 'bg-blue opacity-50',
        )}
        onMouseDown={onResizeStart}
      />

      {collapsed ? (
        <>
          <div className="py-3 border-b border-border flex justify-center">
            <button
              className="bg-transparent border-none text-text-muted cursor-pointer text-base px-1.5 py-1 rounded transition-colors flex items-center justify-center leading-none hover:bg-bg-hover hover:text-text-primary"
              onClick={toggleCollapse}
              title="Expand sidebar"
              aria-label="Toggle sidebar"
            >
              &#9776;
            </button>
            <span
              className={serverStatusClass}
              title={connected ? 'Server connected' : 'Server disconnected'}
            />
          </div>
          <div className="py-2 border-b border-border flex justify-center">
            <button
              className="bg-action text-white border-none w-[30px] h-[30px] rounded-md cursor-pointer text-base font-medium flex items-center justify-center transition-colors hover:bg-action-hover hover:scale-105"
              onClick={onNew}
              title="New conversation"
              aria-label="New conversation"
            >
              +
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1">
            {conversations.map((c) => {
              const isActive = activeTab === c.id;
              const isBusy = busyIds.has(c.id);
              return (
                <button
                  key={c.id}
                  className={clsx(
                    'bg-transparent border border-transparent w-8 h-8 rounded-md cursor-pointer flex items-center justify-center transition-colors hover:bg-bg-hover',
                    isActive && 'bg-blue-dim border-[rgba(56,139,253,0.4)]',
                    isBusy && 'opacity-45',
                  )}
                  onClick={() => onSelect(c.id)}
                  title={c.title}
                  aria-label={c.title}
                >
                  <span
                    className={clsx(
                      'w-2 h-2 rounded-full block',
                      c.status === 'running' && 'bg-status-running shadow-[0_0_6px_rgba(63,185,80,0.5)] animate-pulse',
                      c.status === 'detached' && 'bg-yellow shadow-[0_0_6px_rgba(210,153,34,0.5)]',
                      c.status === 'dead' && 'bg-text-faint',
                    )}
                  />
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="p-4 border-b border-border flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold m-0 tracking-[-0.02em] bg-gradient-to-br from-text-primary to-blue bg-clip-text text-transparent">
                neige
              </h1>
              <span
                className={serverStatusClass}
                title={connected ? 'Server connected' : 'Server disconnected'}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="primary" size="sm" onClick={onNew}>
                <span className="text-[15px] font-normal leading-none">+</span> New
              </Button>
              <button
                className="bg-transparent border-none text-text-muted cursor-pointer text-base px-1.5 py-1 rounded transition-colors flex items-center justify-center leading-none hover:bg-bg-hover hover:text-text-primary"
                onClick={toggleCollapse}
                title="Collapse sidebar"
                aria-label="Toggle sidebar"
              >
                &#9664;
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {conversations.length === 0 ? (
              <div className="text-text-faint text-center px-6 py-12 text-base flex flex-col items-center gap-3 animate-[fadeIn_0.3s_ease]">
                <svg
                  className="text-text-faint mb-1"
                  viewBox="0 0 48 48"
                  fill="none"
                  width="48"
                  height="48"
                >
                  <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                  <path d="M16 22h16M16 28h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
                  <circle cx="12" cy="22" r="1.5" fill="currentColor" opacity="0.3" />
                  <circle cx="12" cy="28" r="1.5" fill="currentColor" opacity="0.3" />
                </svg>
                <p className="text-text-muted text-base m-0">No conversations yet</p>
                <button
                  className="mt-1 bg-bg-tertiary border border-dashed border-border-light text-text-secondary px-[18px] py-2 rounded-md cursor-pointer text-sm font-sans transition-colors hover:bg-bg-hover hover:border-blue hover:text-blue"
                  onClick={onNew}
                >
                  Create your first conversation
                </button>
              </div>
            ) : (
              <>
                {grouped.running.length > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-[0.06em] px-3 pt-2 pb-1 select-none">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-status-running shadow-[0_0_6px_rgba(63,185,80,0.4)]" />
                      Running ({grouped.running.length})
                    </div>
                    {grouped.running.map(renderItem)}
                  </div>
                )}
                {grouped.detached.length > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-[0.06em] px-3 pt-2 pb-1 select-none">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow shadow-[0_0_6px_rgba(210,153,34,0.4)]" />
                      Detached ({grouped.detached.length})
                    </div>
                    {grouped.detached.map(renderItem)}
                  </div>
                )}
                {grouped.dead.length > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-[0.06em] px-3 pt-2 pb-1 select-none">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-text-faint" />
                      Stopped ({grouped.dead.length})
                    </div>
                    {grouped.dead.map(renderItem)}
                  </div>
                )}
              </>
            )}
          </div>
          <PortForwardPanel
            ports={portForwards}
            onUpdate={onPortForwardUpdate}
          />
        </>
      )}
    </aside>
  );
}
