// One conversational turn. User messages get a right-aligned tinted card;
// assistant messages render their AssistantBlock stack edge-to-edge so the
// reader's eye lands on content, not chrome.

import { useState } from 'react';
import { Box, Button, Card, Flex, IconButton, Text, TextArea } from '@radix-ui/themes';
import { Pencil } from 'lucide-react';
import type { AssistantBlock, ChatMessage, ChatTimeline, ToolResultsById } from '../derive';
import type { AnswerQuestionHandler, ContentBlock } from '../types';
import { TextBlock } from './TextBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolUseBlock } from './ToolUseBlock';

interface MessageBubbleProps {
  message: ChatMessage;
  toolResults: ToolResultsById;
  respond: (text: string) => boolean | void;
  /**
   * If true and the message is a user turn, show a pencil that flips the
   * bubble into an inline edit field. Submit calls respond() with the new
   * text — i.e. it's resend-as-follow-up, not a history rewrite.
   */
  canEdit?: boolean;
  /** Sub-agent timelines from the enclosing ChatTimeline. ToolUseBlock looks
   *  up its own entry by tool_use_id and forwards it to the matching
   *  renderer (TaskToolCard uses it; others ignore it). */
  subagents?: Record<string, ChatTimeline>;
  /** Forwarded so AskUserQuestion-style cards inside sub-agent timelines
   *  can still post answers back. */
  onAnswerQuestion?: AnswerQuestionHandler;
}

export function MessageBubble({
  message,
  toolResults,
  respond,
  canEdit,
  subagents,
  onAnswerQuestion,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    return <UserBubble blocks={message.blocks} canEdit={canEdit} respond={respond} />;
  }
  return (
    <AssistantTurn
      blocks={message.blocks}
      toolResults={toolResults}
      isComplete={message.isComplete}
      respond={respond}
      subagents={subagents}
      onAnswerQuestion={onAnswerQuestion}
    />
  );
}

function UserBubble({
  blocks,
  canEdit,
  respond,
}: {
  blocks: ContentBlock[];
  canEdit?: boolean;
  respond: (text: string) => boolean | void;
}) {
  const text = blocks
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_result') return ''; // user-side tool_result, skip
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const onEdit = () => {
    setDraft(text);
    setEditing(true);
  };
  const onSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (respond(trimmed) !== false) {
      setEditing(false);
    }
  };
  const onCancel = () => setEditing(false);

  if (editing) {
    return (
      <Flex justify="end" mb="3">
        <Box style={{ width: '80%' }}>
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            size="2"
            resize="vertical"
            style={{ minHeight: 80 }}
            autoFocus
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                onSave();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
          />
          <Flex gap="2" justify="end" mt="2">
            <Button size="1" variant="soft" color="gray" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="1" onClick={onSave} disabled={!draft.trim()}>
              Send as new message
            </Button>
          </Flex>
        </Box>
      </Flex>
    );
  }

  return (
    <Flex justify="end" mb="3">
      <Box style={{ position: 'relative', maxWidth: '80%' }}>
        {canEdit && (
          <Box style={{ position: 'absolute', top: -10, right: -10, opacity: 0.7 }}>
            <IconButton
              size="1"
              variant="soft"
              color="gray"
              onClick={onEdit}
              aria-label="Edit message"
            >
              <Pencil size={12} />
            </IconButton>
          </Box>
        )}
        <Card
          variant="surface"
          style={{
            background: 'var(--accent-a3)',
            borderColor: 'var(--accent-a5)',
          }}
        >
          <Text
            as="div"
            size="2"
            style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}
          >
            {text}
          </Text>
        </Card>
      </Box>
    </Flex>
  );
}

function AssistantTurn({
  blocks,
  toolResults,
  isComplete,
  respond,
  subagents,
  onAnswerQuestion,
}: {
  blocks: AssistantBlock[];
  toolResults: ToolResultsById;
  isComplete: boolean;
  respond: (text: string) => void;
  subagents?: Record<string, ChatTimeline>;
  onAnswerQuestion?: AnswerQuestionHandler;
}) {
  return (
    <Box mb="4">
      <Flex direction="column" gap="3">
        {blocks.map((block) => {
          switch (block.type) {
            case 'text':
              return (
                <TextBlock
                  key={block.index}
                  text={block.text}
                  isStreaming={block.isStreaming && !isComplete}
                />
              );
            case 'thinking':
              return (
                <ThinkingBlock
                  key={block.index}
                  text={block.text}
                  isStreaming={block.isStreaming}
                />
              );
            case 'tool_use':
              return (
                <ToolUseBlock
                  key={block.index}
                  name={block.name}
                  input={block.input}
                  isStreaming={block.isStreaming}
                  result={toolResults[block.toolUseId]}
                  respond={respond}
                  toolUseId={block.toolUseId}
                  subagents={subagents}
                  toolResults={toolResults}
                  onAnswerQuestion={onAnswerQuestion}
                />
              );
            case 'unknown':
              return (
                <Text key={block.index} size="1" color="gray">
                  [unknown block]
                </Text>
              );
            default:
              return null;
          }
        })}
      </Flex>
    </Box>
  );
}
