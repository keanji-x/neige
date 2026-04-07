import { useCallback } from 'react';
import {
  DockviewReact,
  type IDockviewPanelProps,
  type DockviewReadyEvent,
  type DockviewApi,
} from 'dockview';
import 'dockview-core/dist/styles/dockview.css';
import { useTerminal } from '../hooks/useTerminal';

interface TerminalPanelProps {
  dockviewApiRef: React.MutableRefObject<DockviewApi | null>;
}

/** The component dockview renders inside each panel */
function TerminalComponent({ params }: IDockviewPanelProps<{ convId: string }>) {
  useTerminal(params.convId);

  return (
    <div className="terminal-view" style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div id={`terminal-${params.convId}`} className="terminal-container" />
    </div>
  );
}

const components = {
  terminal: TerminalComponent,
};

export function TerminalPanel({ dockviewApiRef }: TerminalPanelProps) {
  const handleReady = useCallback(
    (e: DockviewReadyEvent) => {
      dockviewApiRef.current = e.api;

      // Restore layout from localStorage
      const saved = localStorage.getItem('neige-dockview-layout');
      if (saved) {
        try {
          const layout = JSON.parse(saved);
          e.api.fromJSON(layout);
        } catch {
          // ignore corrupt layout
        }
      }

      // Auto-save layout on changes
      const save = () => {
        try {
          const json = e.api.toJSON();
          localStorage.setItem('neige-dockview-layout', JSON.stringify(json));
        } catch { /* ignore */ }
      };

      e.api.onDidLayoutChange(save);
    },
    [dockviewApiRef],
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
