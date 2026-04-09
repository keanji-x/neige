import { useCallback, useEffect, useRef, useState } from 'react';

import type { PortForward } from '../components/PortForwardPanel';

export interface RecentCommand {
  program: string;
  cwd: string;
  title: string;
  use_worktree: boolean;
}

export interface RecentFile {
  path: string;
  name: string;
}

export interface NeigeConfig {
  proxy?: string;
  defaultProgram?: string;
  portForwards?: PortForward[];
  recentCommands?: RecentCommand[];
  recentFiles?: RecentFile[];
}

export function useConfig() {
  const [config, setConfig] = useState<NeigeConfig>({});
  const configRef = useRef(config);
  configRef.current = config;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, []);

  const update = useCallback(async (patch: Partial<NeigeConfig>) => {
    const next = { ...configRef.current, ...patch };
    setConfig(next);
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
  }, []);

  return { config, update, loaded };
}
