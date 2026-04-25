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
}

const STICK_THRESHOLD_PX = 120;

export function ChatView({ events, onSubmit }: ChatViewProps) {
  const { timeline, toolResults } = deriveTimeline(events);

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
          />
          {timeline.messages.map((m, i) => (
            <Fragment key={m.id}>
              <MessageBubble message={m} toolResults={toolResults} />
              <PassthroughGroup
                entries={timeline.passthroughs}
                insertedAfterMessageIndex={i}
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
      />
    </Flex>
  );
}

function PassthroughGroup({
  entries,
  insertedAfterMessageIndex,
}: {
  entries: PassthroughEntry[];
  insertedAfterMessageIndex: number | null;
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
          <Renderer key={entry.id} kind={entry.kind} payload={entry.payload} />
        );
      })}
    </>
  );
}
