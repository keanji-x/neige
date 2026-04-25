// Fallback body for tool_use cards: pretty-printed input JSON plus, when
// present, the matched tool result. Header lives in ToolUseBlock.

import { Box } from '@radix-ui/themes';
import { ToolResultBlock } from '../components/ToolResultBlock';
import type { ToolRendererProps } from './registry';

export function DefaultToolCard({ input, result }: ToolRendererProps) {
  return (
    <>
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
        {JSON.stringify(input, null, 2)}
      </Box>
      {result && <ToolResultBlock content={result.content} isError={result.isError} />}
    </>
  );
}
