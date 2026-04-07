import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConvInfo } from '../types';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      className="btn-copy"
      onClick={handleCopy}
      title={text}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

export interface PortForward {
  remotePort: number;
  localPort: number;
}

function PortForwardPanel({
  ports,
  sshHost,
  onUpdate,
}: {
  ports: PortForward[];
  sshHost: string;
  onUpdate: (ports: PortForward[], host: string) => void;
}) {
  const [newRemote, setNewRemote] = useState('');
  const [newLocal, setNewLocal] = useState('');
  const [host, setHost] = useState(sshHost);
  const [expanded, setExpanded] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    setHost(sshHost);
  }, [sshHost]);

  // Poll tunnel status
  useEffect(() => {
    if (!expanded) return;
    const poll = async () => {
      try {
        const res = await fetch('/api/tunnel/status');
        if (res.ok) {
          const data = await res.json();
          setTunnelStatus(data.status);
          setTunnelError(data.error || null);
          setConnecting(false);
        }
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [expanded]);

  const addPort = () => {
    const remote = parseInt(newRemote);
    const local = parseInt(newLocal || newRemote);
    if (!remote || remote <= 0) return;
    if (ports.some((p) => p.remotePort === remote)) return;
    onUpdate([...ports, { remotePort: remote, localPort: local }], host);
    setNewRemote('');
    setNewLocal('');
  };

  const removePort = (remotePort: number) => {
    onUpdate(ports.filter((p) => p.remotePort !== remotePort), host);
  };

  const updateHost = (h: string) => {
    setHost(h);
    onUpdate(ports, h);
  };

  // Always include neige's own port
  const neigePort = parseInt(location.port) || 3030;
  const allPorts = [
    { remotePort: neigePort, localPort: neigePort },
    ...ports.filter((p) => p.remotePort !== neigePort),
  ];

  const startTunnel = async () => {
    setConnecting(true);
    setTunnelError(null);
    try {
      const res = await fetch('/api/tunnel/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssh_host: host,
          ports: allPorts.map((p) => ({
            remote_port: p.remotePort,
            local_port: p.localPort,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTunnelError(typeof data === 'string' ? data : data.error || 'Failed');
        setConnecting(false);
      } else {
        setTunnelStatus(data.status);
        setTunnelError(data.error || null);
        // Keep connecting=true, polling will update
      }
    } catch (e) {
      setTunnelError('Request failed');
      setConnecting(false);
    }
  };

  const stopTunnel = async () => {
    try {
      const res = await fetch('/api/tunnel/stop', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTunnelStatus(data.status);
        setTunnelError(null);
      }
    } catch { /* ignore */ }
  };

  const isConnected = tunnelStatus === 'connected';

  const sshCmd = `ssh -N ${allPorts.map((p) => `-L ${p.localPort}:localhost:${p.remotePort}`).join(' ')} ${host || 'USER@HOST'}`;

  return (
    <div className="sidebar-footer">
      <button
        className="sidebar-footer-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="sidebar-footer-label">
          Port Forward
          {isConnected && <span className="tunnel-dot connected" />}
        </span>
        <span className="sidebar-footer-arrow">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="port-forward-panel">
          <div className="port-forward-host">
            <input
              value={host}
              onChange={(e) => updateHost(e.target.value)}
              placeholder="user@host or ssh config alias"
              className="port-forward-input"
              disabled={isConnected}
            />
          </div>

          <div className="port-forward-table">
            <div className="port-forward-header">
              <span>Server</span>
              <span></span>
              <span>Local</span>
              <span></span>
            </div>
            {allPorts.map((p, i) => (
              <div key={p.remotePort} className="port-forward-row">
                <span className="port-num">{p.remotePort}</span>
                <span className="port-arrow">→</span>
                <span className="port-num">{p.localPort}</span>
                {i === 0 ? (
                  <span className="port-badge">neige</span>
                ) : (
                  <button
                    className="port-remove"
                    onClick={() => removePort(p.remotePort)}
                    disabled={isConnected}
                  >×</button>
                )}
              </div>
            ))}
            {!isConnected && (
              <div className="port-forward-add">
                <input
                  value={newRemote}
                  onChange={(e) => setNewRemote(e.target.value)}
                  placeholder="port"
                  className="port-forward-input port-input-small"
                  onKeyDown={(e) => e.key === 'Enter' && addPort()}
                />
                <span className="port-arrow">→</span>
                <input
                  value={newLocal}
                  onChange={(e) => setNewLocal(e.target.value)}
                  placeholder="same"
                  className="port-forward-input port-input-small"
                  onKeyDown={(e) => e.key === 'Enter' && addPort()}
                />
                <button className="port-add-btn" onClick={addPort}>+</button>
              </div>
            )}
          </div>

          {tunnelError && (
            <div className="tunnel-error">{tunnelError}</div>
          )}

          <div className="tunnel-actions">
            {isConnected ? (
              <button className="btn-tunnel btn-tunnel-stop" onClick={stopTunnel}>
                Disconnect
              </button>
            ) : (
              <button
                className="btn-tunnel btn-tunnel-start"
                onClick={startTunnel}
                disabled={connecting || !host}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            )}
            <CopyButton text={sshCmd} label="Copy cmd" />
          </div>
        </div>
      )}
    </div>
  );
}

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
  sshHost: string;
  onPortForwardUpdate: (ports: PortForward[], host: string) => void;
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
        className="conv-title-input"
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
      className="conv-title"
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
  sshHost,
  onPortForwardUpdate,
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
        <InlineTitle
          value={c.title}
          onSave={(newTitle) => onRename(c.id, newTitle)}
        />
        <span className="conv-meta">
          <span className="conv-path">{c.cwd}</span>
          {c.worktree_branch && (
            <span className="conv-branch" title={c.worktree_branch}>
              &#9741; {c.worktree_branch.replace('neige/', '')}
            </span>
          )}
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
        <>
          <div className="sidebar-collapsed-header">
            <button
              className="sidebar-collapse-btn"
              onClick={toggleCollapse}
              title="Expand sidebar"
            >
              &#9776;
            </button>
            <span
              className={`server-status ${connected ? 'connected' : 'disconnected'}`}
              title={connected ? 'Server connected' : 'Server disconnected'}
            />
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
        <>
          <div className="sidebar-header">
            <div className="sidebar-title-row">
              <h1>neige</h1>
              <span
                className={`server-status ${connected ? 'connected' : 'disconnected'}`}
                title={connected ? 'Server connected' : 'Server disconnected'}
              />
            </div>
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
                {grouped.detached.length > 0 && (
                  <div className="conv-group">
                    <div className="conv-group-label">
                      <span className="conv-group-dot detached" />
                      Detached ({grouped.detached.length})
                    </div>
                    {grouped.detached.map(renderItem)}
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
          <PortForwardPanel
            ports={portForwards}
            sshHost={sshHost}
            onUpdate={onPortForwardUpdate}
          />
        </>
      )}
    </aside>
  );
}
