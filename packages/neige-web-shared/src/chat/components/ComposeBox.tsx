// Compose textarea with Cmd/Ctrl+Enter to submit. Wiring is intentionally
// stubbed — onSubmit just receives the text; the parent decides what to do.

import { useState, useRef } from 'react';
import { Box, Flex, IconButton, TextArea } from '@radix-ui/themes';
import { Send } from 'lucide-react';

interface ComposeBoxProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ComposeBox({ onSubmit, placeholder, disabled }: ComposeBoxProps) {
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue('');
    taRef.current?.focus();
  };

  return (
    <Box
      p="3"
      style={{
        borderTop: '1px solid var(--gray-a5)',
        background: 'var(--color-panel-solid)',
      }}
    >
      <Flex gap="2" align="end">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <TextArea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder ?? 'Send a message — Cmd+Enter to submit'}
            size="2"
            resize="vertical"
            disabled={disabled}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            style={{ minHeight: 64 }}
          />
        </Box>
        <IconButton
          size="3"
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          <Send size={16} />
        </IconButton>
      </Flex>
    </Box>
  );
}
