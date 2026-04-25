// WebSocket-driven event-stream hook for the unified Claude-Code chat surface.
// Counterpart to useTerminalCore: same status state machine, same debounced
// reconnect, but the wire payload here is JSON envelopes instead of framed
// PTY bytes.
//
// Wire contract (mirrors crates/neige-server's chat WS handler):
//   URL: /ws/<sessionId>/chat (ws: or wss: per page protocol)
//   Client → server text JSON:
//     {"type":"attach","last_seq":<number|null>}   // first frame
//     {"type":"user_message","content":"…"}        // when user submits
//   Server → client text JSON:
//     {"type":"hello","last_seq":<n>}              // attach ack
//     {"seq":<n>,"event":<NeigeEvent>}             // every other frame
//   Hello vs event envelopes are disambiguated by `type === 'hello'`. Each
//   live event carries its own seq, so we keep `lastSeqRef` fresh and ask
//   for a Delta on reconnect instead of always replaying from scratch.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveTimeline,
  type ChatTimeline,
  type ToolResultsById,
} from './derive';
import type { NeigeEvent } from './types';

export type ChatSessionStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface UseChatSessionOptions {
  sessionId: string | null;
  onStatusChange?: (status: ChatSessionStatus) => void;
}

export interface UseChatSessionApi {
  /** Live, monotonically growing event stream. */
  events: NeigeEvent[];
  /** Derived from events via deriveTimeline; recomputed on every events change. */
  timeline: ChatTimeline;
  toolResults: ToolResultsById;
  status: ChatSessionStatus;
  /** Send a user message. No-op if WS not open. */
  sendMessage: (content: string) => void;
}

const MAX_RECONNECT_DELAY = 10000;

interface HelloFrame {
  type: 'hello';
  last_seq?: number | null;
}

interface EventEnvelope {
  seq: number;
  event: NeigeEvent;
}

function isHelloFrame(parsed: unknown): parsed is HelloFrame {
  // Hello is a control envelope. None of the NeigeEvent variants use the
  // `hello` discriminator, so a direct type-tag check is safe and simpler
  // than guarding on field presence.
  if (!parsed || typeof parsed !== 'object') return false;
  return (parsed as { type?: unknown }).type === 'hello';
}

function isEventEnvelope(parsed: unknown): parsed is EventEnvelope {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as { seq?: unknown; event?: unknown };
  return typeof obj.seq === 'number' && !!obj.event && typeof obj.event === 'object';
}

export function useChatSession(opts: UseChatSessionOptions): UseChatSessionApi {
  const { sessionId, onStatusChange } = opts;

  const [events, setEvents] = useState<NeigeEvent[]>([]);
  const [status, setStatus] = useState<ChatSessionStatus>('closed');

  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef<number | null>(null);

  // Mirror status into a ref so the WS callbacks can read the latest value
  // without re-running the connect/teardown effect.
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const updateStatus = useCallback((next: ChatSessionStatus) => {
    setStatus(next);
    onStatusChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      // Tear down any existing socket and reset state.
      wsRef.current?.close(1000);
      wsRef.current = null;
      setEvents([]);
      lastSeqRef.current = null;
      updateStatus('closed');
      return;
    }

    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/${sessionId}/chat`;

    // Reset events when the session changes (new attach gets a fresh replay).
    setEvents([]);
    lastSeqRef.current = null;

    const wireWs = (ws: WebSocket) => {
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(e.data);
        } catch {
          return;
        }
        if (isHelloFrame(parsed)) {
          updateStatus('open');
          if (typeof parsed.last_seq === 'number') {
            lastSeqRef.current = parsed.last_seq;
          }
          return;
        }
        if (isEventEnvelope(parsed)) {
          lastSeqRef.current = parsed.seq;
          setEvents((prev) => [...prev, parsed.event]);
        }
      };

      ws.onerror = () => {
        // Always followed by onclose; reconnect is handled there.
      };

      ws.onopen = () => {
        reconnectAttempts = 0;
        // Status flips to 'open' on hello, not here — the server hasn't
        // acked attach yet. Mirrors useTerminalCore semantics.
        ws.send(
          JSON.stringify({ type: 'attach', last_seq: lastSeqRef.current }),
        );
      };

      ws.onclose = (ev) => {
        if (disposed || ev.code === 1000) {
          updateStatus('closed');
          return;
        }
        updateStatus('reconnecting');
        scheduleReconnect();
      };
    };

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      updateStatus('connecting');
      wireWs(ws);
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      reconnectAttempts += 1;
      const delay = Math.min(
        1000 * Math.pow(1.5, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY,
      );
      reconnectTimer = setTimeout(() => {
        if (!disposed) connect();
      }, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
  }, [sessionId, updateStatus]);

  const sendMessage = useCallback((content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // TODO(queue): hold the message until the socket is open / reattaches.
      return;
    }
    ws.send(JSON.stringify({ type: 'user_message', content }));
    // Optimistic local render. Claude only echoes the user turn back on
    // stdout if `--replay-user-messages` is set; rather than depend on that
    // round-trip we synthesize the same NeigeEvent locally so the bubble
    // appears instantly. session_id is left blank — the reducer ignores it.
    const optimistic: NeigeEvent = {
      type: 'user_message',
      session_id: '',
      content: [{ type: 'text', text: content }],
    };
    setEvents((prev) => [...prev, optimistic]);
  }, []);

  const { timeline, toolResults } = useMemo(() => deriveTimeline(events), [events]);

  return { events, timeline, toolResults, status, sendMessage };
}
