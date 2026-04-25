// Renders an assistant text block. Plaintext for now; markdown rendering is
// deferred to a follow-up slice (avoid pulling react-markdown in just yet).

import { Text } from '@radix-ui/themes';

interface TextBlockProps {
  text: string;
  isStreaming?: boolean;
}

export function TextBlock({ text, isStreaming }: TextBlockProps) {
  // TODO(markdown): swap in a markdown renderer once we pick one. Keep
  // streaming-safe (no flicker between chunks).
  return (
    <Text as="div" size="2" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
      {text}
      {isStreaming && <CaretBlink />}
    </Text>
  );
}

function CaretBlink() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: '0.55em',
        height: '1em',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        background: 'var(--accent-9)',
        opacity: 0.7,
        animation: 'neige-caret-blink 1s steps(2) infinite',
      }}
    />
  );
}
