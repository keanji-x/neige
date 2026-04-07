import { useCallback, useRef, useState } from 'react';
import { type DockviewApi } from 'dockview';
import { Sidebar } from './components/Sidebar';
import { TerminalPanel } from './components/TerminalPanel';
import { CreateDialog } from './components/CreateDialog';
import { useConversations } from './hooks/useConversations';
import { useConfig } from './hooks/useConfig';
import type { CreateConvRequest } from './types';
import './App.css';

function App() {
  const { conversations, create, remove } = useConversations();
  const { config, update: updateConfig } = useConfig();
  const [showCreate, setShowCreate] = useState(false);
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

  const handleDelete = useCallback(
    async (id: string) => {
      const api = dockviewApiRef.current;
      if (api) {
        const panel = api.getPanel(id);
        if (panel) api.removePanel(panel);
      }
      await remove(id);
    },
    [remove],
  );

  // Derive active/open state from dockview
  const openTabIds = dockviewApiRef.current
    ? Array.from(dockviewApiRef.current.panels).map((p) => p.id)
    : [];
  const activeTabId = dockviewApiRef.current?.activePanel?.id ?? null;

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        openTabs={openTabIds}
        activeTab={activeTabId}
        onSelect={openTab}
        onDelete={handleDelete}
        onNew={() => setShowCreate(true)}
      />
      <main className="main">
        <TerminalPanel dockviewApiRef={dockviewApiRef} />
      </main>
      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        config={config}
        onConfigUpdate={updateConfig}
      />
    </div>
  );
}

export default App;
