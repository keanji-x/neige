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
    <div className="border-t border-border flex-shrink-0">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 bg-transparent border-none cursor-pointer text-text-muted transition-colors hover:bg-bg-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs font-semibold uppercase tracking-[0.06em]">Port Forward</span>
        <span className="text-[10px]">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <div className="grid grid-cols-[1fr_auto_1fr_28px] gap-1.5 px-1 py-0.5 text-[10px] text-text-faint uppercase tracking-[0.05em]">
              <span>Server</span>
              <span></span>
              <span>Local</span>
              <span></span>
            </div>
            {ports.map((p) => (
              <div
                key={p.remotePort}
                className="grid grid-cols-[1fr_auto_1fr_28px] gap-1.5 items-center px-1 py-[3px] rounded-[3px] text-xs hover:bg-bg-hover"
              >
                <span className="font-mono text-text-secondary">{p.remotePort}</span>
                <span className="text-text-faint text-[11px]">→</span>
                <span className="font-mono text-text-secondary">{p.localPort}</span>
                <button
                  className="bg-transparent border-none text-text-faint cursor-pointer text-sm p-0 leading-none rounded-[3px] w-5 h-5 flex items-center justify-center transition-colors hover:text-red hover:bg-red-dim"
                  onClick={() => removePort(p.remotePort)}
                >×</button>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto_1fr_28px] gap-1.5 items-center py-[3px]">
              <input
                value={newRemote}
                onChange={(e) => setNewRemote(e.target.value)}
                placeholder="port"
                className="w-full px-1.5 py-[3px] text-xs text-center bg-bg-primary border border-border rounded-md text-text-primary font-mono outline-none transition-colors focus:border-blue placeholder:text-text-faint"
                onKeyDown={(e) => e.key === 'Enter' && addPort()}
              />
              <span className="text-text-faint text-[11px]">→</span>
              <input
                value={newLocal}
                onChange={(e) => setNewLocal(e.target.value)}
                placeholder="same"
                className="w-full px-1.5 py-[3px] text-xs text-center bg-bg-primary border border-border rounded-md text-text-primary font-mono outline-none transition-colors focus:border-blue placeholder:text-text-faint"
                onKeyDown={(e) => e.key === 'Enter' && addPort()}
              />
              <button
                className="bg-bg-tertiary border border-border text-text-muted cursor-pointer text-sm w-6 h-6 rounded-[3px] flex items-center justify-center transition-colors hover:bg-action hover:border-action hover:text-white"
                onClick={addPort}
              >+</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
