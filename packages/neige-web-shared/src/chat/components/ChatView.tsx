// Top-level chat orchestrator. Folds NeigeEvent[] → ChatTimeline and renders
// a scrollable bubble feed with a compose box pinned to the bottom.
// Auto-scrolls to bottom on new content unless the user has scrolled away.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { deriveTimeline } from '../derive';
import type { NeigeEvent } from '../types';
import type { AnswerQuestionHandler } from '../types';
import { ChatTimelineView } from './ChatTimelineView';
import { ComposeBox } from './ComposeBox';

interface ChatViewProps {
  events: NeigeEvent[];
  onSubmit?: (text: string) => boolean;
  onStop?: () => void;
  isGenerating?: boolean;
  canSend?: boolean;
  composePlaceholder?: string;
  composeStatusText?: string;
  /**
   * Optional. Wired by ChatPanel when the chat WS is live so dialog
   * passthrough renderers (`neige.ask_user_question`) can reply. Static
   * mounts (e.g. tests, mockEvents demos) leave it undefined and the
   * dialog renders read-only.
   */
  onAnswerQuestion?: AnswerQuestionHandler;
}

const STICK_THRESHOLD_PX = 120;

export function ChatView({
  events,
  onSubmit,
  onStop,
  isGenerating,
  canSend = true,
  composePlaceholder,
  composeStatusText,
  onAnswerQuestion,
}: ChatViewProps) {
  const { timeline, toolResults } = deriveTimeline(events);
  const respond = onSubmit ?? (() => false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // Track whether the user is parked at the bottom; if so, follow new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setStickToBottom(distFromBottom < STICK_THRESHOLD_PX);
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);

  useLayoutEffect(() => {
    if (!stickToBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, stickToBottom]);

  return (
    <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
      {timeline.init && (
        <Box
          px="4"
          py="2"
          style={{
            borderBottom: '1px solid var(--gray-a4)',
            background: 'var(--color-panel-solid)',
          }}
        >
          <Flex gap="3" align="center" wrap="wrap">
            <Text size="1" weight="medium" color="gray">
              {timeline.init.model}
            </Text>
            <Text
              size="1"
              color="gray"
              style={{ fontFamily: 'var(--code-font-family)' }}
            >
              {timeline.init.cwd}
            </Text>
            {timeline.status && (
              <Text size="1" color="gray">
                · {timeline.status}
              </Text>
            )}
          </Flex>
        </Box>
      )}

      <Box ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Box px="4" py="4" style={{ maxWidth: 880, margin: '0 auto' }}>
          {timeline.messages.length === 0 && (
            <Flex justify="center" py="6">
              <Text size="2" color="gray">
                Start a message to Claude.
              </Text>
            </Flex>
          )}
          <ChatTimelineView
            timeline={timeline}
            toolResults={toolResults}
            respond={respond}
            onAnswerQuestion={onAnswerQuestion}
            editableLastUser
          />
          {timeline.result && (
            <Flex justify="center" py="3">
              <Text size="1" color="gray">
                {timeline.result.terminalReason} · {timeline.result.durationMs}ms
                {timeline.result.totalCostUsd > 0 &&
                  ` · $${timeline.result.totalCostUsd.toFixed(4)}`}
              </Text>
            </Flex>
          )}
        </Box>
      </Box>

      <ComposeBox
        onSubmit={(text) => {
          if (!onSubmit) {
            console.log('[ChatView] submit:', text);
            return false;
          }
          return onSubmit(text);
        }}
        onStop={onStop}
        isGenerating={isGenerating}
        canSubmit={canSend}
        placeholder={composePlaceholder}
        statusText={composeStatusText}
      />
    </Flex>
  );
}
