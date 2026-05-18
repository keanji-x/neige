// Renderer for the Read tool: path header + line/page hint + verbatim content.
// The Read tool returns cat -n-formatted text, so we render the result body
// monospaced as-is and let the existing line numbers carry through.

import { Box, Flex, Text } from '@radix-ui/themes';
import { Tooltip } from '@radix-ui/themes';
import { FileSearch } from 'lucide-react';
import { DefaultToolCard } from './DefaultToolCard';
import { shortenPath } from './filePath';
import type { ToolRendererProps } from './registry';
import type { ToolResultContent } from '../types';

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
  pages?: string;
}

export function parseReadInput(input: unknown): ReadInput | null {
  const obj = asRecord(input);
  if (!obj) return null;
  if (typeof obj.file_path !== 'string') return null;
  if (obj.offset !== undefined && typeof obj.offset !== 'number') return null;
  if (obj.limit !== undefined && typeof obj.limit !== 'number') return null;
  if (obj.pages !== undefined && typeof obj.pages !== 'string') return null;
  return {
    file_path: obj.file_path,
    offset: typeof obj.offset === 'number' ? obj.offset : undefined,
    limit: typeof obj.limit === 'number' ? obj.limit : undefined,
    pages: typeof obj.pages === 'string' ? obj.pages : undefined,
  };
}

function flattenResult(content: ToolResultContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'thinking') return b.thinking;
      return '';
    })
    .join('\n');
}

export function ReadToolCard(props: ToolRendererProps) {
  const parsed = parseReadInput(props.input);
  if (!parsed) return <DefaultToolCard {...props} />;
  const { file_path, offset, limit, pages } = parsed;

  const result = props.result;
  const isError = !!result?.isError;
  const bodyText = result ? flattenResult(result.content) : '';

  const lineRange =
    typeof offset === 'number' && typeof limit === 'number'
      ? `lines ${offset}-${offset + limit - 1}`
      : null;

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2" wrap="wrap">
        <FileSearch size={14} />
        <Tooltip content={file_path}>
          <Text
            size="2"
            style={{
              fontFamily: 'var(--code-font-family)',
              color: 'var(--accent-11)',
            }}
          >
            {shortenPath(file_path)}
          </Text>
        </Tooltip>
        {lineRange && (
          <Text size="1" color="gray">
            {lineRange}
          </Text>
        )}
        {pages && (
          <Text size="1" color="gray">
            pages {pages}
          </Text>
        )}
      </Flex>
      {isError ? (
        <Box
          px="3"
          py="2"
          style={{
            borderRadius: 'var(--radius-2)',
            background: 'var(--red-a3)',
            border: '1px solid var(--red-a5)',
            fontFamily: 'var(--code-font-family)',
            fontSize: '0.78rem',
            whiteSpace: 'pre-wrap',
            color: 'var(--red-11)',
            maxHeight: 280,
            overflow: 'auto',
            lineHeight: 1.5,
          }}
        >
          {bodyText || 'read failed'}
        </Box>
      ) : !result ? (
        <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
          reading…
        </Text>
      ) : (
        <Box
          style={{
            fontFamily: 'var(--code-font-family)',
            fontSize: '0.78rem',
            whiteSpace: 'pre',
            color: 'var(--gray-12)',
            background: 'var(--color-panel-solid)',
            padding: '8px 10px',
            borderRadius: 'var(--radius-2)',
            border: '1px solid var(--gray-a4)',
            maxHeight: 280,
            overflow: 'auto',
            lineHeight: 1.5,
          }}
        >
          {bodyText}
        </Box>
      )}
    </Flex>
  );
}
