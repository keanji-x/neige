// Collapsible thinking block. Expanded by default while streaming so the
// user sees it grow, collapsed once the model emits content_block_stop.

import { useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface ThinkingBlockProps {
  text: string;
  isStreaming: boolean;
}

export function ThinkingBlock({ text, isStreaming }: ThinkingBlockProps) {
  // userOpen=null means "follow streaming"; once user clicks, we honor their
  // choice and stop tracking the streaming flag. Avoids setState-in-effect.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? isStreaming;

  return (
    <Box
      style={{
        border: '1px solid var(--gray-a4)',
        borderRadius: 'var(--radius-3)',
        background: 'var(--gray-a2)',
      }}
    >
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2"
        onClick={() => setUserOpen(!open)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} style={{ color: 'var(--gray-10)' }} />
        <Text size="1" weight="medium" color="gray">
          Thinking{isStreaming ? '…' : ''}
        </Text>
      </Flex>
      {open && (
        <Box
          px="3"
          pb="3"
          style={{
            fontFamily: 'var(--code-font-family)',
            fontSize: '0.8rem',
            color: 'var(--gray-11)',
            fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.55,
          }}
        >
          {text}
        </Box>
      )}
    </Box>
  );
}
