// Search-card renderer for the Grep tool: pattern + filter chips up top,
// path:line:content output rendered verbatim in a scrollable code block.

import { Badge, Box, Flex, Text } from '@radix-ui/themes';
import { FileSearch } from 'lucide-react';
import { DefaultToolCard } from './DefaultToolCard';
import type { ToolRendererProps } from './registry';
import type { ToolResultContent } from '../types';

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  caseInsensitive?: boolean; // -i
  showLineNumbers?: boolean; // -n
  afterContext?: number; // -A
  beforeContext?: number; // -B
  context?: number; // -C
  multiline?: boolean;
  head_limit?: number;
}

export function parseGrepInput(input: unknown): GrepInput | null {
  const obj = asRecord(input);
  if (!obj) return null;
  if (typeof obj.pattern !== 'string') return null;
  const out: GrepInput = { pattern: obj.pattern };
  if (typeof obj.path === 'string') out.path = obj.path;
  if (typeof obj.glob === 'string') out.glob = obj.glob;
  if (typeof obj.type === 'string') out.type = obj.type;
  if (
    obj.output_mode === 'content' ||
    obj.output_mode === 'files_with_matches' ||
    obj.output_mode === 'count'
  ) {
    out.output_mode = obj.output_mode;
  }
  if (typeof obj['-i'] === 'boolean') out.caseInsensitive = obj['-i'] as boolean;
  if (typeof obj['-n'] === 'boolean') out.showLineNumbers = obj['-n'] as boolean;
  if (typeof obj['-A'] === 'number') out.afterContext = obj['-A'] as number;
  if (typeof obj['-B'] === 'number') out.beforeContext = obj['-B'] as number;
  if (typeof obj['-C'] === 'number') out.context = obj['-C'] as number;
  if (typeof obj.multiline === 'boolean') out.multiline = obj.multiline;
  if (typeof obj.head_limit === 'number') out.head_limit = obj.head_limit;
  return out;
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

export function GrepToolCard(props: ToolRendererProps) {
  const { input, result } = props;
  const parsed = parseGrepInput(input);
  if (!parsed) return <DefaultToolCard {...props} />;

  const text = result ? resultToText(result.content).trimEnd() : '';
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
        {parsed.type && <Badge color="gray">type: {parsed.type}</Badge>}
        {parsed.output_mode && parsed.output_mode !== 'content' && (
          <Badge color="gray">{parsed.output_mode}</Badge>
        )}
        {parsed.caseInsensitive && <Badge color="gray">-i</Badge>}
        {parsed.showLineNumbers && <Badge color="gray">-n</Badge>}
        {typeof parsed.afterContext === 'number' && (
          <Badge color="gray">-A {parsed.afterContext}</Badge>
        )}
        {typeof parsed.beforeContext === 'number' && (
          <Badge color="gray">-B {parsed.beforeContext}</Badge>
        )}
        {typeof parsed.context === 'number' && <Badge color="gray">-C {parsed.context}</Badge>}
        {parsed.multiline && <Badge color="gray">multiline</Badge>}
        {typeof parsed.head_limit === 'number' && (
          <Badge color="gray">head: {parsed.head_limit}</Badge>
        )}
      </Flex>
      {(parsed.path || parsed.glob) && (
        <Text size="1" color="gray" style={{ fontFamily: 'var(--code-font-family)' }}>
          {parsed.path && <>in {parsed.path}</>}
          {parsed.path && parsed.glob && ' · '}
          {parsed.glob && <>glob: {parsed.glob}</>}
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
          {text || 'Error'}
        </Box>
      ) : result ? (
        text.length === 0 ? (
          <Text size="1" color="gray">
            no matches
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
            }}
          >
            {text}
          </Box>
        )
      ) : null}
    </Flex>
  );
}
