// Renderer for the Task (sub-agent) tool: agent type chip + description, with
// the launch prompt tucked behind a toggle and — when the spawned sub-agent
// has streamed any messages — its full inner timeline below, rendered with
// the same ChatTimelineView as the root chat. Nested Task calls inside the
// sub-agent recurse for free because TaskToolCard re-enters that view via
// the same ToolUseBlock → TaskToolCard chain.

import { useState } from 'react';
import { Badge, Box, Button, Flex, Text } from '@radix-ui/themes';
import { Bot } from 'lucide-react';
import { ChatTimelineView } from '../components/ChatTimelineView';
import { ToolResultBlock } from '../components/ToolResultBlock';
import { DefaultToolCard } from './DefaultToolCard';
import type { ToolRendererProps } from './registry';

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export interface TaskInput {
  description: string;
  prompt: string;
  subagent_type: string;
}

export function parseTaskInput(input: unknown): TaskInput | null {
  const obj = asRecord(input);
  if (!obj) return null;
  if (typeof obj.description !== 'string') return null;
  if (typeof obj.prompt !== 'string') return null;
  if (typeof obj.subagent_type !== 'string') return null;
  return {
    description: obj.description,
    prompt: obj.prompt,
    subagent_type: obj.subagent_type,
  };
}

export function TaskToolCard(props: ToolRendererProps) {
  const { input, result, subagent, toolResults, respond, onAnswerQuestion } = props;
  const [promptOpen, setPromptOpen] = useState(false);
  // Default the sub-agent stream to expanded — the whole point of this
  // refactor is to expose what the sub-agent did. Users can collapse if
  // they want a tighter view.
  const [streamOpen, setStreamOpen] = useState(true);

  const parsed = parseTaskInput(input);
  if (!parsed) return <DefaultToolCard {...props} />;

  const isError = !!result?.isError;
  const subagentMsgCount = subagent?.messages.length ?? 0;
  const hasSubagent = subagentMsgCount > 0;

  return (
    <Flex direction="column" gap="2" mt="1">
      <Flex align="center" gap="2" wrap="wrap">
        <Bot size={14} />
        <Text size="2" weight="bold">
          {parsed.description}
        </Text>
        <Badge color="gray">{parsed.subagent_type}</Badge>
        {hasSubagent && (
          <Badge color="blue" variant="soft">
            {subagentMsgCount} sub-agent message{subagentMsgCount === 1 ? '' : 's'}
          </Badge>
        )}
      </Flex>
      <Flex gap="2" wrap="wrap">
        <Button size="1" variant="ghost" color="gray" onClick={() => setPromptOpen((v) => !v)}>
          {promptOpen ? 'hide prompt' : 'show prompt'}
        </Button>
        {hasSubagent && (
          <Button size="1" variant="ghost" color="gray" onClick={() => setStreamOpen((v) => !v)}>
            {streamOpen ? 'hide sub-agent stream' : 'show sub-agent stream'}
          </Button>
        )}
      </Flex>
      {promptOpen && (
        <Box
          style={{
            fontFamily: 'var(--code-font-family)',
            fontSize: '0.78rem',
            whiteSpace: 'pre-wrap',
            color: 'var(--gray-12)',
            background: 'var(--color-panel-solid)',
            padding: '8px 10px',
            borderRadius: 'var(--radius-2)',
            border: '1px solid var(--gray-a4)',
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {parsed.prompt}
        </Box>
      )}
      {hasSubagent && streamOpen && subagent && (
        <Box
          // Visually nest the sub-agent stream inside the Task card so the
          // hierarchy is obvious at a glance — left bar, slight inset.
          style={{
            borderLeft: '2px solid var(--accent-a6)',
            paddingLeft: 12,
            marginLeft: 4,
          }}
        >
          <ChatTimelineView
            timeline={subagent}
            // Inner-tool results live in the same flat map as the root's
            // (toolUseIds are globally unique). Fall back to an empty
            // record if the host didn't provide one — DefaultToolCard
            // tolerates a missing result.
            toolResults={toolResults ?? {}}
            respond={respond}
            onAnswerQuestion={onAnswerQuestion}
            // Sub-agents don't accept user input; the pencil-edit
            // affordance would be misleading.
            editableLastUser={false}
          />
        </Box>
      )}
      {result && (
        <Box>
          {isError && (
            <Text size="1" style={{ color: 'var(--red-11)' }}>
              Error
            </Text>
          )}
          <ToolResultBlock content={result.content} isError={isError} />
        </Box>
      )}
    </Flex>
  );
}
