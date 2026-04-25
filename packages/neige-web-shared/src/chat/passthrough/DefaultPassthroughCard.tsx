// Universal fallback for passthrough events. Mirrors ToolUseBlock's collapsed
// card style: header with kind + chevron, click to expand pretty-printed JSON.

import { useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';

interface DefaultPassthroughCardProps {
  kind: string;
  payload: unknown;
}

export function DefaultPassthroughCard({ kind, payload }: DefaultPassthroughCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <Box
      mb="3"
      style={{
        borderRadius: 'var(--radius-3)',
        border: '1px solid var(--gray-a4)',
        background: 'var(--gray-a2)',
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
        <Activity size={14} style={{ color: 'var(--gray-10)' }} />
        <Text
          size="1"
          weight="medium"
          color="gray"
          style={{ fontFamily: 'var(--code-font-family)' }}
        >
          {kind}
        </Text>
      </Flex>
      {open && (
        <Box px="3" pb="3">
          <Box
            mt="1"
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
            }}
          >
            {JSON.stringify(payload, null, 2)}
          </Box>
        </Box>
      )}
    </Box>
  );
}
