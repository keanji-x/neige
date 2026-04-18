import { useSyncExternalStore } from 'react';

type Listener = () => void;

let snapshot: ReadonlySet<string> = new Set();
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export const terminalBusyStore = {
  set(id: string, busy: boolean) {
    const has = snapshot.has(id);
    if (busy === has) return;
    const next = new Set(snapshot);
    if (busy) next.add(id);
    else next.delete(id);
    snapshot = next;
    notify();
  },
  getSnapshot(): ReadonlySet<string> {
    return snapshot;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

export function useBusyTerminalIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    terminalBusyStore.subscribe,
    terminalBusyStore.getSnapshot,
    terminalBusyStore.getSnapshot,
  );
}

export function useTerminalBusy(id: string | null): boolean {
  const ids = useBusyTerminalIds();
  return id ? ids.has(id) : false;
}
