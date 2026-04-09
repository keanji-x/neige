import { useCallback, useRef } from 'react';
import {
  DockviewReact,
  type IDockviewPanelProps,
  type DockviewReadyEvent,
  type DockviewApi,
} from 'dockview';
import 'dockview-core/dist/styles/dockview.css';
import { useTerminal } from '../hooks/useTerminal';
import { FileViewer } from './FileViewer';

interface TerminalPanelProps {
  dockviewApiRef: React.MutableRefObject<DockviewApi | null>;
  onTabClose?: (id: string) => void;
  onTabStateChange?: () => void;
}

/** The component dockview renders inside each panel */
function TerminalComponent({ params }: IDockviewPanelProps<{ convId: string }>) {
  const { busy } = useTerminal(params.convId);

  return (
    <div className="terminal-view">
      <div id={`terminal-${params.convId}`} className="terminal-container" />
      {busy && <div className="terminal-busy-overlay" />}
    </div>
  );
}

/** File viewer panel for markdown/code files */
function FileViewerComponent({ params }: IDockviewPanelProps<{ filePath: string }>) {
  return <FileViewer filePath={params.filePath} />;
}

const components = {
  terminal: TerminalComponent,
  fileViewer: FileViewerComponent,
};

export function TerminalPanel({ dockviewApiRef, onTabClose, onTabStateChange }: TerminalPanelProps) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saveLayout = useCallback((api: DockviewApi) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        const json = api.toJSON();
        fetch('/api/layout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        });
      } catch { /* ignore */ }
    }, 500);
  }, []);

  const handleReady = useCallback(
    async (e: DockviewReadyEvent) => {
      dockviewApiRef.current = e.api;

      // Restore layout from server, filtering out dead panels
      try {
        const [layoutRes, convsRes] = await Promise.all([
          fetch('/api/layout'),
          fetch('/api/conversations'),
        ]);
        if (layoutRes.ok && convsRes.ok) {
          const layout = await layoutRes.json();
          const convs: { id: string }[] = await convsRes.json();
          if (layout) {
            const validIds = new Set(convs.map((c) => c.id));
            // Remove panels that reference non-existent sessions
            if (layout.panels) {
              layout.panels = Object.fromEntries(
                Object.entries(layout.panels).filter(([id]) => validIds.has(id))
              );
            }
            // Clean grid leaves that reference removed panels
            if (layout.grid) {
              const cleanNode = (node: Record<string, unknown>): boolean => {
                if (node.type === 'leaf' && Array.isArray(node.data)) {
                  node.data = (node.data as { id: string }[]).filter(
                    (d) => validIds.has(d.id)
                  );
                  return (node.data as unknown[]).length > 0;
                }
                if (node.type === 'branch' && Array.isArray(node.data)) {
                  node.data = (node.data as Record<string, unknown>[]).filter(cleanNode);
                  return (node.data as unknown[]).length > 0;
                }
                return true;
              };
              cleanNode(layout.grid.root);
            }
            // Only restore if there are still valid panels
            const hasPanels = Object.keys(layout.panels ?? {}).length > 0;
            if (hasPanels) {
              try {
                e.api.fromJSON(layout);
              } catch {
                // layout corrupt after filtering, start fresh
              }
            }
          }
        }
      } catch {
        // ignore
      }

      // Auto-save layout on changes
      e.api.onDidLayoutChange(() => saveLayout(e.api));

      // Sync tab state to parent on panel/active changes
      e.api.onDidAddPanel(() => onTabStateChange?.());
      e.api.onDidRemovePanel((panel) => {
        onTabClose?.(panel.id);
        onTabStateChange?.();
      });
      e.api.onDidActivePanelChange(() => onTabStateChange?.());

      // Initial sync after layout restore
      onTabStateChange?.();
    },
    [dockviewApiRef, onTabClose, onTabStateChange, saveLayout],
  );

  return (
    <div className="terminal-panel">
      <DockviewReact
        components={components}
        onReady={handleReady}
        className="dockview-theme-dark"
      />
    </div>
  );
}
