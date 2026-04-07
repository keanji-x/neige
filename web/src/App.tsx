import { useCallback, useEffect, useRef, useState } from 'react';
import { type DockviewApi } from 'dockview';
import { Sidebar } from './components/Sidebar';
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
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const syncTabState = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    setOpenTabIds(api.panels.map((p) => p.id));
    setActiveTabId(api.activePanel?.id ?? null);
  }, []);

  const openTab = useCallback(
    (id: string, title?: string) => {
      const api = dockviewApiRef.current;
      if (!api) return;

      // If panel already exists, focus it
      const existing = api.getPanel(id);
      if (existing) {
        existing.api.setActive();
        return;
      }

      // Use provided title, or look up from current conversations
      const resolvedTitle =
        title ?? conversations.find((c) => c.id === id)?.title ?? 'untitled';

      api.addPanel({
        id,
        title: resolvedTitle,
        component: 'terminal',
        params: { convId: id },
      });
    },
    [conversations],
  );

  const handleCreate = useCallback(
    async (req: CreateConvRequest) => {
      const conv = await create(req);
      openTab(conv.id, conv.title);
    },
    [create, openTab],
  );

  // Tab X in dockview = detach only (panel already removed by dockview)
  const handleTabClose = useCallback((_id: string) => {
    // Panel is already removed by dockview; syncTabState updates sidebar
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

  // Sync conversation titles → dockview tab titles
  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    for (const panel of api.panels) {
      const conv = conversations.find((c) => c.id === panel.id);
      if (conv && panel.title !== conv.title) {
        panel.setTitle(conv.title);
      }
    }
  }, [conversations]);

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
        portForwards={config.portForwards || []}
        onPortForwardUpdate={(ports) => {
          updateConfig({ portForwards: ports });
        }}
      />
      <main className="main">
        <TerminalPanel
          dockviewApiRef={dockviewApiRef}
          onTabClose={handleTabClose}
          onTabStateChange={syncTabState}
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
