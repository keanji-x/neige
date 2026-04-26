// TUI-style renderer for the Bash tool: command on top with a $ glyph,
// output below in a monospace scrollable block. No outer card — ToolUseBlock
// already frames it.

import type { CSSProperties } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { DefaultToolCard } from './DefaultToolCard';
import type { ToolRendererProps } from './registry';
import type { ToolResultContent } from '../types';

interface BashInput {
  command: string;
  description?: string;
  runInBackground?: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function parseBashInput(input: unknown): BashInput | null {
  const obj = asRecord(input);
  if (!obj) return null;
  if (typeof obj.command !== 'string') return null;
  const description = typeof obj.description === 'string' ? obj.description : undefined;
  const runInBackground =
    typeof obj.run_in_background === 'boolean' ? obj.run_in_background : undefined;
  return { command: obj.command, description, runInBackground };
}

// Pull a flat string out of a tool result: bare strings pass through, arrays
// of content blocks are joined with newlines. Unknown blocks are JSON-encoded
// rather than dropped so the user sees something rather than silence.
export function flattenResultContent(content: ToolResultContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      if (b && typeof b === 'object' && 'type' in b) {
        if (b.type === 'text' && typeof (b as { text?: unknown }).text === 'string') {
          return (b as { text: string }).text;
        }
        if (b.type === 'thinking' && typeof (b as { thinking?: unknown }).thinking === 'string') {
          return (b as { thinking: string }).thinking;
        }
      }
      try {
        return JSON.stringify(b);
      } catch {
        return '';
      }
    })
    .join('\n');
}

const MONO: CSSProperties = {
  fontFamily: 'var(--code-font-family)',
  fontSize: '0.78rem',
  lineHeight: 1.5,
};

export function BashToolCard(props: ToolRendererProps) {
  const { input, isStreaming, result } = props;

  // While streaming the input may be a partial JSON object — try to parse,
  // but don't bail to the default card just because `command` hasn't shown
  // up yet. Show what we have.
  const parsed = parseBashInput(input);
  if (!parsed && !isStreaming) return <DefaultToolCard {...props} />;

  const command = parsed?.command ?? '';
  const description = parsed?.description;
  const runInBackground = parsed?.runInBackground === true;

  const hasResult = !!result;
  const isError = !!result?.isError;
  const outputText = result ? flattenResultContent(result.content) : '';

  return (
    <Flex direction="column" gap="2">
      {description && (
        <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
          {description}
        </Text>
      )}
      <Box
        style={{
          ...MONO,
          whiteSpace: 'pre',
          color: 'var(--gray-12)',
          background: 'var(--color-panel-solid)',
          padding: '8px 10px',
          borderRadius: 'var(--radius-2)',
          border: '1px solid var(--gray-a4)',
          overflowX: 'auto',
        }}
      >
        <Text color="gray" style={MONO}>
          ${' '}
        </Text>
        {runInBackground && (
          <Text size="1" color="gray" style={{ ...MONO, marginRight: 6 }}>
            [background]{' '}
          </Text>
        )}
        <span>{command}</span>
        {isStreaming && (
          <Text color="gray" style={MONO}>
            {' '}
            …
          </Text>
        )}
      </Box>
      {hasResult && (
        <Box
          style={{
            ...MONO,
            whiteSpace: 'pre-wrap',
            color: isError ? 'var(--red-11)' : 'var(--gray-12)',
            background: 'var(--gray-a2)',
            padding: '8px 10px',
            borderRadius: 'var(--radius-2)',
            border: `1px solid ${isError ? 'var(--red-a6)' : 'var(--gray-a4)'}`,
            maxHeight: 280,
            overflow: 'auto',
          }}
        >
          {/* TODO: strip/render ANSI */}
          {isError && (
            <Text as="div" color="red" size="1" style={{ marginBottom: 4 }}>
              exit non-zero
            </Text>
          )}
          {outputText.length > 0 ? (
            outputText
          ) : (
            <Text size="1" color="gray">
              (no output)
            </Text>
          )}
        </Box>
      )}
    </Flex>
  );
}
