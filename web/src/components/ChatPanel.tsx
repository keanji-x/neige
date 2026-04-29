// Per-tab chat-mode (Mode B) content. Sibling of TerminalPanel's terminal
// view: same role (renders one session inside a dockview tab) but powered
// by the chat WebSocket + ChatView instead of xterm.

import { ChatView, useChatSession } from '@neige/shared';

interface ChatPanelProps {
  sessionId: string;
}

const STATUS_LABELS: Record<string, string> = {
  connecting: 'connecting...',
  open: 'connected',
  closed: 'disconnected',
  reconnecting: 'reconnecting...',
};

const COMPOSE_STATUS: Record<string, string> = {
  connecting: 'Connecting. Drafts stay here.',
  open: 'Connected',
  closed: 'Session closed. Draft preserved.',
  reconnecting: 'Reconnecting. Drafts stay here.',
};

const COMPOSE_PLACEHOLDER: Record<string, string> = {
  connecting: 'Write a draft while the chat connects...',
  open: 'Message Claude...',
  closed: 'Session is closed',
  reconnecting: 'Write a draft while the chat reconnects...',
};

export function ChatPanel({ sessionId }: ChatPanelProps) {
  const { events, status, sendMessage, stop, isGenerating, answerQuestion } = useChatSession({
    sessionId,
  });

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
      <ChatView
        events={events}
        onSubmit={sendMessage}
        onStop={stop}
        isGenerating={isGenerating}
        canSend={status === 'open'}
        composePlaceholder={COMPOSE_PLACEHOLDER[status] ?? 'Message Claude...'}
        composeStatusText={COMPOSE_STATUS[status] ?? status}
        onAnswerQuestion={status === 'open' ? answerQuestion : undefined}
      />
      <div className={`chat-status-chip chat-status-${status}`} role="status" aria-live="polite">
        {STATUS_LABELS[status] ?? status}
      </div>
    </div>
  );
}
