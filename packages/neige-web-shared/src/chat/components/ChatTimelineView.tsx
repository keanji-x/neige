// Pure renderer for a ChatTimeline's messages + passthroughs.
//
// Used in two places:
//   1. ChatView wraps it with the session-init banner, scroll container,
//      result footer, and ComposeBox to form the full chat surface.
//   2. TaskToolCard renders a sub-agent's ChatTimeline inline by calling
//      this same component on `timeline.subagents[toolUseId]` — gives
//      sub-agents the exact same renderer stack as the root, including
//      tool cards and nested Task expansion (recursion happens for free
//      because TaskToolCard re-enters this view).
//
// Stays purely declarative: no scroll handling, no input affordances of
// its own, no fetching. Caller passes `respond` and `onAnswerQuestion`
// when those interactions make sense (root chat); sub-agents pass no-ops.

import { Fragment } from 'react';
import type { ChatTimeline, PassthroughEntry, ToolResultsById } from '../derive';
import type { AnswerQuestionHandler } from '../types';
import { DefaultPassthroughCard, lookupRenderer } from '../passthrough';
import { MessageBubble } from './MessageBubble';

interface ChatTimelineViewProps {
  timeline: ChatTimeline;
  toolResults: ToolResultsById;
  respond: (text: string) => void;
  onAnswerQuestion?: AnswerQuestionHandler;
  /**
   * When true, the most recent user message gets a pencil affordance for
   * inline edit-and-resend. Disable for sub-agent timelines — sub-agents
   * don't accept user input, so the icon would be misleading.
   */
  editableLastUser?: boolean;
}

export function ChatTimelineView({
  timeline,
  toolResults,
  respond,
  onAnswerQuestion,
  editableLastUser = false,
}: ChatTimelineViewProps) {
  const lastUserIndex = (() => {
    if (!editableLastUser) return -1;
    for (let i = timeline.messages.length - 1; i >= 0; i -= 1) {
      if (timeline.messages[i].role === 'user') return i;
    }
    return -1;
  })();

  return (
    <>
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
            subagents={timeline.subagents}
            respond={respond}
            onAnswerQuestion={onAnswerQuestion}
            canEdit={m.role === 'user' && i === lastUserIndex}
          />
          <PassthroughGroup
            entries={timeline.passthroughs}
            insertedAfterMessageIndex={i}
            onAnswerQuestion={onAnswerQuestion}
          />
        </Fragment>
      ))}
    </>
  );
}

function PassthroughGroup({
  entries,
  insertedAfterMessageIndex,
  onAnswerQuestion,
}: {
  entries: PassthroughEntry[];
  insertedAfterMessageIndex: number | null;
  onAnswerQuestion?: AnswerQuestionHandler;
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
