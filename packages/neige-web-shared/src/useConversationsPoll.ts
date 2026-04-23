import { useCallback, useEffect, useState } from 'react';
import { listConversations } from './api';
import type { ConvInfo } from './types';

export interface UseConversationsPollOptions {
  /** Base polling interval, in milliseconds. Defaults to 5000. */
  intervalMs?: number;
}

export interface UseConversationsPollApi {
  conversations: ConvInfo[];
  connected: boolean;
  refresh: () => Promise<void>;
}

/**
 * Polls /api/conversations on a timer. Applies exponential backoff (1.5x) on
 * consecutive failures up to 30s, and exposes a `connected` flag that drives
 * the "offline" badge in either frontend.
 */
export function useConversationsPoll(
  opts: UseConversationsPollOptions = {},
): UseConversationsPollApi {
  const intervalMs = opts.intervalMs ?? 5000;
  const [conversations, setConversations] = useState<ConvInfo[]>([]);
  const [connected, setConnected] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await listConversations();
      setConversations(list);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failCount = 0;
    const MAX_INTERVAL = 30000;

    const poll = async () => {
      try {
        const list = await listConversations(controller.signal);
        if (controller.signal.aborted) return;
        setConversations(list);
        setConnected(true);
        failCount = 0;
      } catch {
        if (controller.signal.aborted) return;
        setConnected(false);
        failCount++;
      }
      if (!controller.signal.aborted) {
        const delay =
          failCount > 0
            ? Math.min(intervalMs * Math.pow(1.5, failCount), MAX_INTERVAL)
            : intervalMs;
        timer = setTimeout(poll, delay);
      }
    };

    poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return { conversations, connected, refresh };
}
