import { useCallback, useMemo, useRef, useState } from 'react';
import type { ConvInfo } from '../types';

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
  openTabs: string[];
  activeTab: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

const COLLAPSED_WIDTH = 48;
const MIN_EXPANDED_WIDTH = 200;
const SNAP_THRESHOLD = 120;
const DEFAULT_WIDTH = 280;
const MAX_WIDTH = 480;

export function Sidebar({
  className = '',
  conversations,
  openTabs,
  activeTab,
  onSelect,
  onDelete,
  onNew,
}: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const dragging = useRef(false);
  const widthBeforeCollapse = useRef(DEFAULT_WIDTH);

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
        // Snap to collapsed
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
    const dead = conversations.filter((c) => c.status === 'dead');
    return { running, dead };
  }, [conversations]);

  const renderItem = (c: ConvInfo) => (
    <div
      key={c.id}
      className={`conv-item ${activeTab === c.id ? 'active' : ''} ${openTabs.includes(c.id) ? 'open' : ''}`}
      onClick={() => onSelect(c.id)}
    >
      <div className="conv-status-dot-wrapper">
        <span className={`conv-status-dot ${c.status}`} />
      </div>
      <div className="conv-info">
        <span className="conv-title">{c.title}</span>
        <span className="conv-meta">
          <span className="conv-path">{c.cwd}</span>
          <span className="conv-time">{timeAgo(c.created_at)}</span>
        </span>
      </div>
      <div className="conv-actions">
        <button
          className="btn-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(c.id);
          }}
          title="Delete"
        >
          ×
        </button>
      </div>
    </div>
  );

  return (
    <aside
      className={`sidebar ${className} ${collapsed ? 'sidebar-collapsed' : ''}`}
      style={{ width: sidebarWidth, minWidth: COLLAPSED_WIDTH }}
    >
      <div
        className={`sidebar-resize-handle ${dragging.current ? 'dragging' : ''}`}
        onMouseDown={onResizeStart}
      />

      {collapsed ? (
        /* ===== Collapsed view ===== */
        <>
          <div className="sidebar-collapsed-header">
            <button
              className="sidebar-collapse-btn"
              onClick={toggleCollapse}
              title="Expand sidebar"
            >
              &#9776;
            </button>
          </div>
          <div className="sidebar-collapsed-actions">
            <button className="sidebar-collapsed-btn" onClick={onNew} title="New conversation">
              +
            </button>
          </div>
          <div className="conv-list-collapsed">
            {conversations.map((c) => (
              <button
                key={c.id}
                className={`conv-dot-btn ${activeTab === c.id ? 'active' : ''}`}
                onClick={() => onSelect(c.id)}
                title={c.title}
              >
                <span className={`conv-status-dot ${c.status}`} />
              </button>
            ))}
          </div>
        </>
      ) : (
        /* ===== Expanded view ===== */
        <>
          <div className="sidebar-header">
            <h1>neige</h1>
            <div className="sidebar-header-actions">
              <button className="btn-new" onClick={onNew}>
                <span className="btn-new-icon">+</span> New
              </button>
              <button
                className="sidebar-collapse-btn"
                onClick={toggleCollapse}
                title="Collapse sidebar"
              >
                &#9664;
              </button>
            </div>
          </div>
          <div className="conv-list">
            {conversations.length === 0 ? (
              <div className="empty-list">
                <svg className="empty-list-icon" viewBox="0 0 48 48" fill="none" width="48" height="48">
                  <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                  <path d="M16 22h16M16 28h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
                  <circle cx="12" cy="22" r="1.5" fill="currentColor" opacity="0.3" />
                  <circle cx="12" cy="28" r="1.5" fill="currentColor" opacity="0.3" />
                </svg>
                <p>No conversations yet</p>
                <button className="btn-empty-new" onClick={onNew}>
                  Create your first conversation
                </button>
              </div>
            ) : (
              <>
                {grouped.running.length > 0 && (
                  <div className="conv-group">
                    <div className="conv-group-label">
                      <span className="conv-group-dot running" />
                      Running ({grouped.running.length})
                    </div>
                    {grouped.running.map(renderItem)}
                  </div>
                )}
                {grouped.dead.length > 0 && (
                  <div className="conv-group">
                    <div className="conv-group-label">
                      <span className="conv-group-dot dead" />
                      Stopped ({grouped.dead.length})
                    </div>
                    {grouped.dead.map(renderItem)}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
