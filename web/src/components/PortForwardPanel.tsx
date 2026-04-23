import { useState } from 'react';

export interface PortForward {
  remotePort: number;
  localPort: number;
}

export function PortForwardPanel({
  ports,
  onUpdate,
}: {
  ports: PortForward[];
  onUpdate: (ports: PortForward[]) => void;
}) {
  const [newRemote, setNewRemote] = useState('');
  const [newLocal, setNewLocal] = useState('');
  const [expanded, setExpanded] = useState(false);

  const addPort = () => {
    const remote = parseInt(newRemote);
    const local = parseInt(newLocal || newRemote);
    if (!remote || remote <= 0) return;
    if (ports.some((p) => p.remotePort === remote)) return;
    onUpdate([...ports, { remotePort: remote, localPort: local }]);
    setNewRemote('');
    setNewLocal('');
  };

  const removePort = (remotePort: number) => {
    onUpdate(ports.filter((p) => p.remotePort !== remotePort));
  };

  return (
    <div className="sidebar-footer">
      <button
        className="sidebar-footer-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="sidebar-footer-label">Port Forward</span>
        <span className="sidebar-footer-arrow">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="port-forward-panel">
          <div className="port-forward-table">
            <div className="port-forward-header">
              <span>Server</span>
              <span></span>
              <span>Local</span>
              <span></span>
            </div>
            {ports.map((p) => (
              <div key={p.remotePort} className="port-forward-row">
                <span className="port-num">{p.remotePort}</span>
                <span className="port-arrow">→</span>
                <span className="port-num">{p.localPort}</span>
                <button
                  className="port-remove"
                  onClick={() => removePort(p.remotePort)}
                >×</button>
              </div>
            ))}
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
          </div>
        </div>
      )}
    </div>
  );
}
