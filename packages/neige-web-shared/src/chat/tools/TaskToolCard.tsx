// Renderer for the Task (sub-agent) tool: agent type chip + description, with
// the launch prompt tucked behind a toggle and the agent's reply below.

import { useState } from 'react';
import { Badge, Box, Button, Flex, Text } from '@radix-ui/themes';
import { Bot } from 'lucide-react';
import { DefaultToolCard } from './DefaultToolCard';
import { ToolResultBlock } from '../components/ToolResultBlock';
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
  const { input, result } = props;
  const [open, setOpen] = useState(false);

  const parsed = parseTaskInput(input);
  if (!parsed) return <DefaultToolCard {...props} />;

  const isError = !!result?.isError;

  return (
    <Flex direction="column" gap="2" mt="1">
      <Flex align="center" gap="2" wrap="wrap">
        <Bot size={14} />
        <Text size="2" weight="bold">
          {parsed.description}
        </Text>
        <Badge color="gray">{parsed.subagent_type}</Badge>
      </Flex>
      <Box>
        <Button size="1" variant="ghost" color="gray" onClick={() => setOpen((v) => !v)}>
          {open ? 'hide prompt' : 'show prompt'}
        </Button>
      </Box>
      {open && (
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
