// Renderer for TodoWrite: mirrors the Claude Code TUI checklist UX with
// status icons, in-progress activeForm swap, and a chip row of counts.
// Falls back to DefaultToolCard if the input shape doesn't validate.

import { Box, Flex, Text } from '@radix-ui/themes';
import { Square, CircleDot, CheckCircle2 } from 'lucide-react';
import { DefaultToolCard } from './DefaultToolCard';
import { ToolResultBlock } from '../components/ToolResultBlock';
import type { ToolRendererProps } from './registry';

type Status = 'pending' | 'in_progress' | 'completed';

interface Todo {
  id?: string;
  content: string;
  activeForm?: string;
  status: Status;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function isStatus(v: unknown): v is Status {
  return v === 'pending' || v === 'in_progress' || v === 'completed';
}

export function parseTodos(input: unknown): Todo[] | null {
  const obj = asRecord(input);
  if (!obj || !Array.isArray(obj.todos)) return null;
  const out: Todo[] = [];
  for (const t of obj.todos) {
    const tr = asRecord(t);
    if (!tr) return null;
    if (typeof tr.content !== 'string') return null;
    if (!isStatus(tr.status)) return null;
    out.push({
      id: typeof tr.id === 'string' ? tr.id : undefined,
      content: tr.content,
      activeForm: typeof tr.activeForm === 'string' ? tr.activeForm : undefined,
      status: tr.status,
    });
  }
  return out;
}

export function countByStatus(todos: Todo[]): {
  pending: number;
  in_progress: number;
  completed: number;
} {
  const counts = { pending: 0, in_progress: 0, completed: 0 };
  for (const t of todos) counts[t.status] += 1;
  return counts;
}

const PULSE_KEYFRAMES = '@keyframes neige-todo-pulse{0%,100%{opacity:1}50%{opacity:0.45}}';

function StatusIcon({ status }: { status: Status }) {
  if (status === 'completed') {
    return <CheckCircle2 size={14} style={{ color: 'var(--green-9)', flexShrink: 0 }} />;
  }
  if (status === 'in_progress') {
    return (
      <CircleDot
        size={14}
        style={{
          color: 'var(--accent-11)',
          flexShrink: 0,
          animation: 'neige-todo-pulse 1.4s ease-in-out infinite',
        }}
      />
    );
  }
  return <Square size={14} style={{ color: 'var(--gray-9)', flexShrink: 0 }} />;
}

export function TodoWriteToolCard(props: ToolRendererProps) {
  const { input, isStreaming, result } = props;

  const todos = parseTodos(input);
  if (!todos) return <DefaultToolCard {...props} />;

  const counts = countByStatus(todos);
  const chipParts: string[] = [];
  if (counts.pending) chipParts.push(`${counts.pending} pending`);
  if (counts.in_progress) chipParts.push(`${counts.in_progress} in progress`);
  if (counts.completed) chipParts.push(`${counts.completed} done`);

  return (
    <Flex direction="column" gap="2" mt="1">
      <style>{PULSE_KEYFRAMES}</style>
      {chipParts.length > 0 && (
        <Text size="1" style={{ color: 'var(--accent-11)' }}>
          {chipParts.join(' · ')}
        </Text>
      )}
      <Flex direction="column" gap="1">
        {todos.map((t, i) => {
          const isCompleted = t.status === 'completed';
          const label =
            t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content;
          return (
            <Flex key={t.id ?? i} align="start" gap="2">
              <Box style={{ paddingTop: 2 }}>
                <StatusIcon status={t.status} />
              </Box>
              <Text
                size="2"
                style={{
                  color: isCompleted ? 'var(--gray-9)' : 'var(--gray-12)',
                  textDecoration: isCompleted ? 'line-through' : undefined,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.4,
                }}
              >
                {label}
              </Text>
            </Flex>
          );
        })}
        {isStreaming && (
          <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
            …
          </Text>
        )}
      </Flex>
      {result && result.isError ? (
        <ToolResultBlock content={result.content} isError={result.isError} />
      ) : result ? (
        <Text size="1" color="gray">
          saved
        </Text>
      ) : null}
    </Flex>
  );
}
