// Compose textarea: Enter submits, Shift+Enter inserts a newline. Cmd/Ctrl+Enter
// also submits for muscle-memory parity with editor compose surfaces. Wiring
// is intentionally stubbed — onSubmit just receives the text; the parent
// decides what to do.

import { useState, useRef } from 'react';
import { Box, Flex, IconButton, Text, TextArea } from '@radix-ui/themes';
import { Send, Square } from 'lucide-react';

interface ComposeBoxProps {
  onSubmit: (text: string) => boolean;
  /** When set + isGenerating is true, the right-hand button becomes a Stop. */
  onStop?: () => void;
  isGenerating?: boolean;
  placeholder?: string;
  /** Hard-disable the input, e.g. for a read-only mount. */
  disabled?: boolean;
  /** Block sending while keeping the draft editable. */
  canSubmit?: boolean;
  statusText?: string;
}

export function ComposeBox({
  onSubmit,
  onStop,
  isGenerating,
  placeholder,
  disabled,
  canSubmit = true,
  statusText,
}: ComposeBoxProps) {
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sendBlocked = disabled || !canSubmit;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || sendBlocked) return;
    if (onSubmit(trimmed)) {
      setValue('');
      taRef.current?.focus();
    }
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
            placeholder={placeholder ?? 'Message Claude...'}
            size="2"
            resize="none"
            disabled={disabled}
            onKeyDown={(e) => {
              // IME composition guard: Enter while a CJK candidate is open
              // must not submit. `keyCode === 229` is the legacy signal;
              // `nativeEvent.isComposing` is the modern one. Either flag
              // means the IME is mid-composition.
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                submit();
              }
            }}
            style={{
              minHeight: 76,
              maxHeight: 180,
              overflowY: 'auto',
              lineHeight: 1.5,
            }}
          />
          <Flex justify="between" align="center" mt="1" gap="3">
            <Text size="1" color="gray">
              Enter to send · Shift+Enter for newline
            </Text>
            {statusText && (
              <Text
                size="1"
                color={canSubmit ? 'gray' : 'amber'}
                role="status"
                aria-live="polite"
              >
                {statusText}
              </Text>
            )}
          </Flex>
        </Box>
        {isGenerating && onStop ? (
          <IconButton
            size="3"
            color="red"
            variant="solid"
            onClick={onStop}
            aria-label="Stop generation"
          >
            <Square size={14} />
          </IconButton>
        ) : (
          <IconButton
            size="3"
            onClick={submit}
            disabled={sendBlocked || !value.trim()}
            aria-label="Send message"
          >
            <Send size={16} />
          </IconButton>
        )}
      </Flex>
    </Box>
  );
}
