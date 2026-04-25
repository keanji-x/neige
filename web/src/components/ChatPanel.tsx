// Per-tab chat-mode (Mode B) content. Sibling of TerminalPanel's terminal
// view: same role (renders one session inside a dockview tab) but powered
// by the chat WebSocket + ChatView instead of xterm.

import { ChatView, useChatSession } from '@neige/shared';

interface ChatPanelProps {
  sessionId: string;
}

const STATUS_LABELS: Record<string, string> = {
  connecting: 'connecting…',
  open: 'connected',
  closed: 'disconnected',
  reconnecting: 'reconnecting…',
};

export function ChatPanel({ sessionId }: ChatPanelProps) {
  const { events, status, sendMessage } = useChatSession({ sessionId });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        minHeight: 0,
      }}
    >
      <ChatView events={events} onSubmit={sendMessage} />
      <div className={`chat-status-chip chat-status-${status}`}>
        {STATUS_LABELS[status] ?? status}
      </div>
    </div>
  );
}
