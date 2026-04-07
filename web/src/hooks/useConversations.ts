import { useCallback, useEffect, useState } from 'react';
import type { ConvInfo, CreateConvRequest } from '../types';

const API = '';

export function useConversations() {
  const [conversations, setConversations] = useState<ConvInfo[]>([]);
  const [connected, setConnected] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/conversations`);
      if (res.ok) {
        setConversations(await res.json());
        setConnected(true);
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    }
  }, []);

  const create = useCallback(async (req: CreateConvRequest) => {
    const res = await fetch(`${API}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(await res.text());
    const conv: ConvInfo = await res.json();
    await refresh();
    return conv;
  }, [refresh]);

  const resume = useCallback(async (id: string) => {
    const res = await fetch(`${API}/api/conversations/${id}/resume`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(await res.text());
    const conv: ConvInfo = await res.json();
    await refresh();
    return conv;
  }, [refresh]);

  const rename = useCallback(async (id: string, title: string) => {
    await fetch(`${API}/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await fetch(`${API}/api/conversations/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failCount = 0;
    const BASE_INTERVAL = 3000;
    const MAX_INTERVAL = 30000;

    const poll = async () => {
      try {
        const res = await fetch(`${API}/api/conversations`, { signal: controller.signal });
        if (res.ok) {
          setConversations(await res.json());
          setConnected(true);
          failCount = 0;
        } else {
          setConnected(false);
          failCount++;
        }
      } catch {
        if (!controller.signal.aborted) {
          setConnected(false);
          failCount++;
        }
      }
      if (!controller.signal.aborted) {
        const delay = failCount > 0
          ? Math.min(BASE_INTERVAL * Math.pow(1.5, failCount), MAX_INTERVAL)
          : BASE_INTERVAL;
        timer = setTimeout(poll, delay);
      }
    };

    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  return { conversations, connected, create, resume, rename, remove, refresh };
}
