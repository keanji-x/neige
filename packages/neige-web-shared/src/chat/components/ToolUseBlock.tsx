// Tool invocation card. One-line summary up top, expand to see full input
// JSON and (if matched by tool_use_id) the nested tool result.

import { useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FilePen,
  FileSearch,
  Globe,
  ListTodo,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ChatTimeline, ToolResultsById } from '../derive';
import type { AnswerQuestionHandler, ToolResultContent } from '../types';
import { ToolResultBlock } from './ToolResultBlock';
import { DefaultToolCard, lookupToolRenderer } from '../tools';

interface ToolUseBlockProps {
  name: string;
  input: unknown;
  isStreaming: boolean;
  result?: { content: ToolResultContent; isError: boolean };
  respond: (text: string) => void;
  /** Stable Anthropic-issued id; threaded into the renderer for correlation
   *  (sub-agent lookup, stable keys, etc.). */
  toolUseId: string;
  /** Sub-agent timelines keyed by their spawning tool_use_id. Only the entry
   *  matching this block's `toolUseId` is forwarded to the renderer. */
  subagents?: Record<string, ChatTimeline>;
  /** Flat tool result lookup so nested ChatTimelineViews (inside
   *  TaskToolCard) can find their own inner-tool results. */
  toolResults?: ToolResultsById;
  /** AskUserQuestion answer dispatcher; passed through to renderers that
   *  may host interactive cards inside their sub-agent timeline. */
  onAnswerQuestion?: AnswerQuestionHandler;
}

const ICONS: Record<string, LucideIcon> = {
  Read: FileSearch,
  Glob: FileSearch,
  Grep: FileSearch,
  Edit: FilePen,
  Write: FilePen,
  NotebookEdit: FilePen,
  Bash: Terminal,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Bot,
  TodoWrite: ListTodo,
};

function ToolIcon({ name }: { name: string }) {
  const Icon = ICONS[name] ?? Wrench;
  return <Icon size={14} style={{ color: 'var(--accent-11)' }} />;
}

function summarizeInput(name: string, input: unknown): string {
  if (input == null || typeof input !== 'object') {
    return typeof input === 'string' ? input : '';
  }
  const obj = input as Record<string, unknown>;
  switch (name) {
    case 'Read':
    case 'Glob':
    case 'NotebookEdit':
      return String(obj.file_path ?? obj.pattern ?? obj.path ?? '');
    case 'Grep':
      return String(obj.pattern ?? '');
    case 'Bash': {
      const cmd = String(obj.command ?? '');
      return cmd.length > 120 ? cmd.slice(0, 117) + '…' : cmd;
    }
    case 'Edit':
    case 'Write':
      return String(obj.file_path ?? '');
    case 'WebFetch':
    case 'WebSearch':
      return String(obj.url ?? obj.query ?? '');
    case 'Task':
      return String(obj.description ?? obj.subagent_type ?? '');
    case 'TodoWrite': {
      const todos = obj.todos;
      if (Array.isArray(todos)) return `${todos.length} item${todos.length === 1 ? '' : 's'}`;
      return '';
    }
    default: {
      const json = JSON.stringify(input);
      return json.length > 80 ? json.slice(0, 77) + '…' : json;
    }
  }
}

export function ToolUseBlock({
  name,
  input,
  isStreaming,
  result,
  respond,
  toolUseId,
  subagents,
  toolResults,
  onAnswerQuestion,
}: ToolUseBlockProps) {
  const [open, setOpen] = useState(false);
  const summary = summarizeInput(name, input);
  const Renderer = lookupToolRenderer(name) ?? DefaultToolCard;
  const subagent = subagents?.[toolUseId];

  return (
    <Box
      style={{
        borderRadius: 'var(--radius-3)',
        border: '1px solid var(--accent-a5)',
        background: 'var(--accent-a2)',
        overflow: 'hidden',
      }}
    >
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2"
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <ToolIcon name={name} />
        <Text size="2" weight="bold" style={{ color: 'var(--accent-12)' }}>
          {name}
        </Text>
        {summary && (
          <Text
            size="1"
            color="gray"
            truncate
            style={{ fontFamily: 'var(--code-font-family)', flex: 1, minWidth: 0 }}
          >
            {summary}
          </Text>
        )}
        {isStreaming && (
          <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
            …
          </Text>
        )}
      </Flex>
      {open && (
        <Box px="3" pb="3">
          <Renderer
            name={name}
            input={input}
            isStreaming={isStreaming}
            result={result}
            respond={respond}
            toolUseId={toolUseId}
            subagent={subagent}
            toolResults={toolResults}
            onAnswerQuestion={onAnswerQuestion}
          />
        </Box>
      )}
      {!open && result && (
        <Box px="3" pb="3" pt="0">
          <ToolResultBlock content={result.content} isError={result.isError} />
        </Box>
      )}
    </Box>
  );
}
