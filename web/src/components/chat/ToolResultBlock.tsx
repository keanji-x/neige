// Folded tool result, rendered nested under its matching ToolUseBlock.
// Shows a one-line summary by default; click to expand the full payload.

import { useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ToolResultContent } from '@neige/shared';

interface ToolResultBlockProps {
  content: ToolResultContent;
  isError: boolean;
}

function summarize(content: ToolResultContent): { text: string; charCount: number } {
  if (typeof content === 'string') {
    return { text: content, charCount: content.length };
  }
  const text = content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'thinking') return b.thinking;
      return JSON.stringify(b);
    })
    .join('\n');
  return { text, charCount: text.length };
}

export function ToolResultBlock({ content, isError }: ToolResultBlockProps) {
  const [open, setOpen] = useState(false);
  const { text, charCount } = summarize(content);

  return (
    <Box
      mt="2"
      style={{
        borderRadius: 'var(--radius-2)',
        border: '1px solid var(--gray-a4)',
        background: 'var(--gray-a2)',
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
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {isError ? (
          <AlertCircle size={12} style={{ color: 'var(--red-10)' }} />
        ) : (
          <CheckCircle2 size={12} style={{ color: 'var(--green-10)' }} />
        )}
        <Text
          size="1"
          weight="medium"
          style={{ color: isError ? 'var(--red-11)' : 'var(--gray-11)' }}
        >
          {isError ? 'Error' : 'Result'}
        </Text>
        <Text size="1" color="gray">
          · {charCount.toLocaleString()} chars
        </Text>
      </Flex>
      {open && (
        <Box
          px="3"
          pb="3"
          style={{
            fontFamily: 'var(--code-font-family)',
            fontSize: '0.78rem',
            whiteSpace: 'pre-wrap',
            color: isError ? 'var(--red-11)' : 'var(--gray-12)',
            maxHeight: 360,
            overflow: 'auto',
            lineHeight: 1.5,
          }}
        >
          {text}
        </Box>
      )}
    </Box>
  );
}
