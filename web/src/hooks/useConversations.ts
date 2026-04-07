import { useCallback, useEffect, useState } from 'react';
import type { ConvInfo, CreateConvRequest } from '../types';

const API = '';

export function useConversations() {
  const [conversations, setConversations] = useState<ConvInfo[]>([]);

  const refresh = useCallback(async () => {
    const res = await fetch(`${API}/api/conversations`);
    if (res.ok) {
      setConversations(await res.json());
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

  const remove = useCallback(async (id: string) => {
    await fetch(`${API}/api/conversations/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { conversations, create, remove, refresh };
}
