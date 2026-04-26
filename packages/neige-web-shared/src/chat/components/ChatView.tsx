// Top-level chat orchestrator. Folds NeigeEvent[] → ChatTimeline and renders
// a scrollable bubble feed with a compose box pinned to the bottom.
// Auto-scrolls to bottom on new content unless the user has scrolled away.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { deriveTimeline, type PassthroughEntry } from '../derive';
import type { NeigeEvent } from '../types';
import { DefaultPassthroughCard, lookupRenderer } from '../passthrough';
import { MessageBubble } from './MessageBubble';
import { ComposeBox } from './ComposeBox';

interface ChatViewProps {
  events: NeigeEvent[];
  onSubmit?: (text: string) => void;
  onStop?: () => void;
  isGenerating?: boolean;
  /**
   * Optional. Wired by ChatPanel when the chat WS is live so dialog
   * passthrough renderers (`neige.ask_user_question`) can reply. Static
   * mounts (e.g. tests, mockEvents demos) leave it undefined and the
   * dialog renders read-only.
   */
  onAnswerQuestion?: (questionId: string, answer: string) => void;
}

const STICK_THRESHOLD_PX = 120;

export function ChatView({ events, onSubmit, onStop, isGenerating, onAnswerQuestion }: ChatViewProps) {
  const { timeline, toolResults } = deriveTimeline(events);
  const respond = onSubmit ?? (() => {});
  // Only the most-recent user message is editable; earlier turns belong to the
  // committed conversation.
  const lastUserIndex = (() => {
    for (let i = timeline.messages.length - 1; i >= 0; i -= 1) {
      if (timeline.messages[i].role === 'user') return i;
    }
    return -1;
  })();

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
                No messages yet.
              </Text>
            </Flex>
          )}
          <PassthroughGroup
            entries={timeline.passthroughs}
            insertedAfterMessageIndex={null}
            onAnswerQuestion={onAnswerQuestion}
          />
          {timeline.messages.map((m, i) => (
            <Fragment key={m.id}>
              <MessageBubble
                message={m}
                toolResults={toolResults}
                respond={respond}
                canEdit={m.role === 'user' && i === lastUserIndex}
              />
              <PassthroughGroup
                entries={timeline.passthroughs}
                insertedAfterMessageIndex={i}
                onAnswerQuestion={onAnswerQuestion}
              />
            </Fragment>
          ))}
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
          if (onSubmit) onSubmit(text);
          else console.log('[ChatView] submit:', text);
        }}
        onStop={onStop}
        isGenerating={isGenerating}
      />
    </Flex>
  );
}

function PassthroughGroup({
  entries,
  insertedAfterMessageIndex,
  onAnswerQuestion,
}: {
  entries: PassthroughEntry[];
  insertedAfterMessageIndex: number | null;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
}) {
  const slice = entries.filter(
    (e) => e.insertedAfterMessageIndex === insertedAfterMessageIndex,
  );
  if (slice.length === 0) return null;
  return (
    <>
      {slice.map((entry) => {
        const Renderer = lookupRenderer(entry.kind) ?? DefaultPassthroughCard;
        return (
          <Renderer
            key={entry.id}
            kind={entry.kind}
            payload={entry.payload}
            answerQuestion={onAnswerQuestion}
          />
        );
      })}
    </>
  );
}
