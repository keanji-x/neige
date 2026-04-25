// Renders an assistant text block as GFM markdown via `marked`.
//
// Trust note: Claude is generating this content; we use dangerouslySetInnerHTML
// without DOMPurify since the same trust applies as Claude.ai itself. If neige
// ever sends untrusted content through this path (e.g. user-submitted bodies),
// add a sanitizer.

import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

interface TextBlockProps {
  text: string;
  isStreaming?: boolean;
}

export function TextBlock({ text, isStreaming }: TextBlockProps) {
  const html = useMemo(() => marked.parse(text, { async: false }) as string, [text]);
  return (
    <div
      className={`neige-md${isStreaming ? ' neige-md-streaming' : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
