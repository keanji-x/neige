import { useCallback, useEffect, useState } from 'react';

export interface NeigeConfig {
  proxy?: string;
  defaultProgram?: string;
  [key: string]: unknown;
}

export function useConfig() {
  const [config, setConfig] = useState<NeigeConfig>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
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
