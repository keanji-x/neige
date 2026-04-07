import { useCallback, useEffect, useState } from 'react';

import type { PortForward } from '../components/PortForwardPanel';

export interface NeigeConfig {
  proxy?: string;
  defaultProgram?: string;
  portForwards?: PortForward[];
}

export function useConfig() {
  const [config, setConfig] = useState<NeigeConfig>({});
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
    const next = { ...config, ...patch };
    setConfig(next);
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
  }, [config]);

  return { config, update, loaded };
}
