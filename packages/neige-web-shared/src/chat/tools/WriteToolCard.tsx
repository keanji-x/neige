// Renderer for the Write tool: path header + line count + content preview.
// Mirrors EditToolCard's structure but with a single body block.

import { Box, Flex, Text } from '@radix-ui/themes';
import { Tooltip } from '@radix-ui/themes';
import { FilePen } from 'lucide-react';
import { DefaultToolCard } from './DefaultToolCard';
import { shortenPath, lineCount } from './filePath';
import type { ToolRendererProps } from './registry';

const MAX_BLOCK_CHARS = 4000;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

interface WriteInput {
  file_path: string;
  content: string;
}

export function parseWriteInput(input: unknown): WriteInput | null {
  const obj = asRecord(input);
  if (!obj) return null;
  if (typeof obj.file_path !== 'string') return null;
  // content may stream in piece by piece; coerce missing to "".
  if (obj.content !== undefined && typeof obj.content !== 'string') return null;
  return {
    file_path: obj.file_path,
    content: typeof obj.content === 'string' ? obj.content : '',
  };
}

function truncate(s: string): { text: string; cut: number } {
  if (s.length <= MAX_BLOCK_CHARS) return { text: s, cut: 0 };
  return { text: s.slice(0, MAX_BLOCK_CHARS), cut: s.length - MAX_BLOCK_CHARS };
}

function resultErrorText(result: ToolRendererProps['result']): string | null {
  if (!result || !result.isError) return null;
  if (typeof result.content === 'string') return result.content;
  return result.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function WriteToolCard(props: ToolRendererProps) {
  const parsed = parseWriteInput(props.input);
  if (!parsed) return <DefaultToolCard {...props} />;
  const { file_path, content } = parsed;
  const lines = lineCount(content);
  const { text, cut } = truncate(content);
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
        <Text size="1" color="gray">
          {lines} {lines === 1 ? 'line' : 'lines'}
        </Text>
      </Flex>
      {errorText && (
        <Text size="1" style={{ color: 'var(--red-11)' }}>
          {errorText}
        </Text>
      )}
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
          maxHeight: 280,
          overflow: 'auto',
          lineHeight: 1.5,
        }}
      >
        {text}
        {cut > 0 && (
          <Text as="div" size="1" color="gray" mt="1">
            …({cut.toLocaleString()} more chars)
          </Text>
        )}
      </Box>
      {!errorText && props.result && (
        <Text size="1" color="gray">
          written
        </Text>
      )}
    </Flex>
  );
}
