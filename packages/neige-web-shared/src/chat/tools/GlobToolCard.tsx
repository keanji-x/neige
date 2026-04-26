// Search-card renderer for the Glob tool: pattern + match count, then a flat
// monospaced path list (one per non-empty line) in a scrollable block.

import { Box, Flex, Text } from '@radix-ui/themes';
import { FileSearch } from 'lucide-react';
import { DefaultToolCard } from './DefaultToolCard';
import type { ToolRendererProps } from './registry';
import type { ToolResultContent } from '../types';

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export interface GlobInput {
  pattern: string;
  path?: string;
}

export function parseGlobInput(input: unknown): GlobInput | null {
  const obj = asRecord(input);
  if (!obj) return null;
  if (typeof obj.pattern !== 'string') return null;
  const out: GlobInput = { pattern: obj.pattern };
  if (typeof obj.path === 'string') out.path = obj.path;
  return out;
}

export function countNonEmptyLines(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) n++;
  }
  return n;
}

function resultToText(content: ToolResultContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'thinking') return b.thinking;
      return '';
    })
    .join('\n');
}

export function GlobToolCard(props: ToolRendererProps) {
  const { input, result } = props;
  const parsed = parseGlobInput(input);
  if (!parsed) return <DefaultToolCard {...props} />;

  const text = result ? resultToText(result.content) : '';
  const lines = text ? text.split('\n').filter((l) => l.trim().length > 0) : [];
  const isError = !!result?.isError;

  return (
    <Flex direction="column" gap="2" mt="1">
      <Flex align="center" gap="2" wrap="wrap">
        <FileSearch size={14} />
        <Text
          size="2"
          style={{ fontFamily: 'var(--code-font-family)', color: 'var(--gray-12)' }}
        >
          {parsed.pattern}
        </Text>
        {result && !isError && (
          <Text size="1" color="gray">
            {lines.length} {lines.length === 1 ? 'match' : 'matches'}
          </Text>
        )}
      </Flex>
      {parsed.path && (
        <Text size="1" color="gray" style={{ fontFamily: 'var(--code-font-family)' }}>
          in {parsed.path}
        </Text>
      )}
      {result && isError ? (
        <Box
          px="2"
          py="1"
          style={{
            borderRadius: 'var(--radius-2)',
            background: 'var(--red-a3)',
            border: '1px solid var(--red-a4)',
            color: 'var(--red-11)',
            fontFamily: 'var(--code-font-family)',
            fontSize: '0.78rem',
            whiteSpace: 'pre-wrap',
            maxHeight: 280,
            overflow: 'auto',
          }}
        >
          {text.trimEnd() || 'Error'}
        </Box>
      ) : result ? (
        lines.length === 0 ? (
          <Text size="1" color="gray">
            no matches
          </Text>
        ) : (
          <Box
            style={{
              fontFamily: 'var(--code-font-family)',
              fontSize: '0.78rem',
              color: 'var(--gray-12)',
              background: 'var(--color-panel-solid)',
              padding: '8px 10px',
              borderRadius: 'var(--radius-2)',
              border: '1px solid var(--gray-a4)',
              maxHeight: 280,
              overflow: 'auto',
            }}
          >
            {lines.map((line, i) => (
              <div key={i} style={{ whiteSpace: 'pre' }}>
                {line}
              </div>
            ))}
          </Box>
        )
      ) : null}
    </Flex>
  );
}
