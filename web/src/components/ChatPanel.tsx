// Per-tab chat-mode (Mode B) content. Sibling of TerminalPanel's terminal
// view: same role (renders one session inside a dockview tab) but powered
// by the chat WebSocket + ChatView instead of xterm.

import { useState } from 'react';
import { IconButton, Tooltip } from '@radix-ui/themes';
import { ChatView, useChatSession } from '@neige/shared';
import { ShareDialog } from './ShareDialog';

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
  const { events, status, sendMessage, stop, isGenerating } = useChatSession({ sessionId });
  const [shareOpen, setShareOpen] = useState(false);

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
      />
      <div className="chat-toolbar">
        <Tooltip content="Share this conversation">
          <IconButton
            size="1"
            variant="soft"
            color="gray"
            onClick={() => setShareOpen(true)}
            aria-label="Share"
          >
            <ShareIcon />
          </IconButton>
        </Tooltip>
        <span className={`chat-status-chip chat-status-${status}`}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>
      <ShareDialog
        sessionId={sessionId}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}

function ShareIcon() {
  // Inline SVG keeps the icon set zero-dep; matches the lucide stroke style
  // already used elsewhere.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
