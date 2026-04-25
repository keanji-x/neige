// Hook event renderer (registered against the 'hook.' prefix). Pulls
// tool_name / tool_input / subtype out of the payload defensively; unknown
// shapes still get the JSON dump so nothing's lost.

import { useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface HookEventCardProps {
  kind: string;
  payload: unknown;
}

// Backend emits kind as "hook.<event_snake>.<phase>" (phase = started|response).
// Render the event part PascalCase and the phase as a low-key trailing label.
function humanizeSubtype(kind: string): { event: string; phase: string | null } {
  const sub = kind.startsWith('hook.') ? kind.slice('hook.'.length) : kind;
  const lastDot = sub.lastIndexOf('.');
  const eventPart = lastDot >= 0 ? sub.slice(0, lastDot) : sub;
  const phase = lastDot >= 0 ? sub.slice(lastDot + 1) : null;
  const event = eventPart
    .split('_')
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');
  return { event, phase };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function summarize(payload: unknown): string {
  const obj = asRecord(payload);
  if (!obj) return '';
  const toolName = typeof obj.tool_name === 'string' ? obj.tool_name : null;
  if (toolName) return toolName;
  const subtype = typeof obj.subtype === 'string' ? obj.subtype : null;
  if (subtype) return subtype;
  const message = typeof obj.message === 'string' ? obj.message : null;
  if (message) return message.length > 80 ? message.slice(0, 77) + '…' : message;
  return '';
}

export function HookEventCard({ kind, payload }: HookEventCardProps) {
  const [open, setOpen] = useState(false);
  const { event, phase } = humanizeSubtype(kind);
  const summary = summarize(payload);

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
        <Box
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--accent-9)',
            flexShrink: 0,
          }}
        />
        <Text size="1" weight="medium" style={{ color: 'var(--gray-12)' }}>
          {event}
        </Text>
        {phase && (
          <Text size="1" color="gray" style={{ fontVariant: 'small-caps' }}>
            {phase}
          </Text>
        )}
        {summary && (
          <Text
            size="1"
            color="gray"
            truncate
            style={{ fontFamily: 'var(--code-font-family)', flex: 1, minWidth: 0 }}
          >
            {summary}
          </Text>
        )}
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
