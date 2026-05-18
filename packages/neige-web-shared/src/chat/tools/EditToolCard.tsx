// Renderer for the Edit tool: shows a path header + before/after diff blocks
// styled like the Claude Code TUI's edit card. Streaming-tolerant: half-built
// old_string/new_string just render as their partial text.

import { Badge, Box, Flex, Text } from '@radix-ui/themes';
import { Tooltip } from '@radix-ui/themes';
import { FilePen } from 'lucide-react';
import { DefaultToolCard } from './DefaultToolCard';
import { shortenPath } from './filePath';
import type { ToolRendererProps } from './registry';

const MAX_BLOCK_CHARS = 4000;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all: boolean;
}

export function parseEditInput(input: unknown): EditInput | null {
  const obj = asRecord(input);
  if (!obj) return null;
  if (typeof obj.file_path !== 'string') return null;
  // old_string / new_string may be missing or partial during streaming — coerce
  // anything non-string to "" rather than rejecting the whole card. But if they
  // are present and not strings, treat as malformed.
  if (obj.old_string !== undefined && typeof obj.old_string !== 'string') return null;
  if (obj.new_string !== undefined && typeof obj.new_string !== 'string') return null;
  if (obj.replace_all !== undefined && typeof obj.replace_all !== 'boolean') return null;
  return {
    file_path: obj.file_path,
    old_string: typeof obj.old_string === 'string' ? obj.old_string : '',
    new_string: typeof obj.new_string === 'string' ? obj.new_string : '',
    replace_all: typeof obj.replace_all === 'boolean' ? obj.replace_all : false,
  };
}

function truncate(s: string): { text: string; cut: number } {
  if (s.length <= MAX_BLOCK_CHARS) return { text: s, cut: 0 };
  return { text: s.slice(0, MAX_BLOCK_CHARS), cut: s.length - MAX_BLOCK_CHARS };
}

interface DiffBlockProps {
  text: string;
  tone: 'before' | 'after';
}

function DiffBlock({ text, tone }: DiffBlockProps) {
  const { text: shown, cut } = truncate(text);
  const bg = tone === 'before' ? 'var(--red-a3)' : 'var(--green-a3)';
  return (
    <Box
      style={{
        fontFamily: 'var(--code-font-family)',
        fontSize: '0.78rem',
        whiteSpace: 'pre-wrap',
        color: 'var(--gray-12)',
        background: bg,
        padding: '8px 10px',
        borderRadius: 'var(--radius-2)',
        border: '1px solid var(--gray-a4)',
        maxHeight: 280,
        overflow: 'auto',
        lineHeight: 1.5,
      }}
    >
      {shown}
      {cut > 0 && (
        <Text as="div" size="1" color="gray" mt="1">
          …({cut.toLocaleString()} more chars)
        </Text>
      )}
    </Box>
  );
}

function resultErrorText(result: ToolRendererProps['result']): string | null {
  if (!result || !result.isError) return null;
  if (typeof result.content === 'string') return result.content;
  return result.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function EditToolCard(props: ToolRendererProps) {
  const parsed = parseEditInput(props.input);
  if (!parsed) return <DefaultToolCard {...props} />;
  const { file_path, old_string, new_string, replace_all } = parsed;
  const errorText = resultErrorText(props.result);

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <FilePen size={14} />
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
        {replace_all && (
          <Badge color="amber" variant="soft" size="1">
            replace all
          </Badge>
        )}
      </Flex>
      {errorText && (
        <Text size="1" style={{ color: 'var(--red-11)' }}>
          {errorText}
        </Text>
      )}
      <DiffBlock text={old_string} tone="before" />
      <DiffBlock text={new_string} tone="after" />
    </Flex>
  );
}
