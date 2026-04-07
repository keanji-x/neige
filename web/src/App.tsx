import { useCallback, useRef, useState } from 'react';
import { type DockviewApi } from 'dockview';
import { Sidebar, type PortForward } from './components/Sidebar';
import { TerminalPanel } from './components/TerminalPanel';
import { CreateDialog } from './components/CreateDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useConversations } from './hooks/useConversations';
import { useConfig } from './hooks/useConfig';
import type { CreateConvRequest } from './types';
import './App.css';

function App() {
  const { conversations, connected, create, rename, remove } = useConversations();
  const { config, update: updateConfig } = useConfig();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const dockviewApiRef = useRef<DockviewApi | null>(null);

  const openTab = useCallback(
    (id: string) => {
      const api = dockviewApiRef.current;
      if (!api) return;

      // If panel already exists, focus it
      const existing = api.getPanel(id);
      if (existing) {
        existing.api.setActive();
        return;
      }

      // Find title
      const conv = conversations.find((c) => c.id === id);
      const title = conv?.title ?? 'untitled';

      api.addPanel({
        id,
        title,
        component: 'terminal',
        params: { convId: id },
      });
    },
    [conversations],
  );

  const handleCreate = useCallback(
    async (req: CreateConvRequest) => {
      const conv = await create(req);
      openTab(conv.id);
    },
    [create, openTab],
  );

  // Tab X = detach (just close the panel, keep session alive)
  const handleTabClose = useCallback((id: string) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const panel = api.getPanel(id);
    if (panel) api.removePanel(panel);
  }, []);

  // Sidebar delete = real delete with confirmation
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    const api = dockviewApiRef.current;
    if (api) {
      const panel = api.getPanel(id);
      if (panel) api.removePanel(panel);
    }
    await remove(id);
    setDeleteTarget(null);
  }, [deleteTarget, remove]);

  // Derive active/open state from dockview
  const openTabIds = dockviewApiRef.current
    ? Array.from(dockviewApiRef.current.panels).map((p) => p.id)
    : [];
  const activeTabId = dockviewApiRef.current?.activePanel?.id ?? null;

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        connected={connected}
        openTabs={openTabIds}
        activeTab={activeTabId}
        onSelect={openTab}
        onRename={rename}
        onDelete={(id) => {
          const conv = conversations.find((c) => c.id === id);
          setDeleteTarget({ id, title: conv?.title ?? 'untitled' });
        }}
        onNew={() => setShowCreate(true)}
        portForwards={(config.portForwards as PortForward[]) || []}
        sshHost={(config.sshHost as string) || ''}
        onPortForwardUpdate={(ports, host) => {
          updateConfig({ portForwards: ports, sshHost: host });
        }}
      />
      <main className="main">
        <TerminalPanel
          dockviewApiRef={dockviewApiRef}
          onTabClose={handleTabClose}
        />
      </main>
      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        config={config}
        onConfigUpdate={updateConfig}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Session"
        message={`Permanently delete "${deleteTarget?.title}"? This will remove the session and its metadata.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default App;
