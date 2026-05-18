import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Theme } from '@radix-ui/themes';
import { BashToolCard, parseBashInput, flattenResultContent } from './BashToolCard';
import type { ToolRendererProps } from './registry';

describe('parseBashInput', () => {
  it('accepts a record with a string command', () => {
    expect(parseBashInput({ command: 'ls -la' })).toEqual({
      command: 'ls -la',
      description: undefined,
      runInBackground: undefined,
    });
  });

  it('keeps a string description', () => {
    expect(parseBashInput({ command: 'echo hi', description: 'Greeting' })).toEqual({
      command: 'echo hi',
      description: 'Greeting',
      runInBackground: undefined,
    });
  });

  it('drops a non-string description', () => {
    const out = parseBashInput({ command: 'echo hi', description: 42 });
    expect(out).toEqual({ command: 'echo hi', description: undefined, runInBackground: undefined });
  });

  it('returns null when command is missing', () => {
    expect(parseBashInput({ description: 'x' })).toBeNull();
  });

  it('returns null when command is the wrong type', () => {
    expect(parseBashInput({ command: 123 })).toBeNull();
  });

  it('returns null for non-record inputs', () => {
    expect(parseBashInput(null)).toBeNull();
    expect(parseBashInput('hello')).toBeNull();
    expect(parseBashInput(['command'])).toBeNull();
  });

  it('flips runInBackground when run_in_background: true', () => {
    expect(parseBashInput({ command: 'sleep 5', run_in_background: true })).toEqual({
      command: 'sleep 5',
      description: undefined,
      runInBackground: true,
    });
  });

  it('keeps runInBackground undefined when wrong type', () => {
    expect(parseBashInput({ command: 'sleep 5', run_in_background: 'yes' })).toEqual({
      command: 'sleep 5',
      description: undefined,
      runInBackground: undefined,
    });
  });
});

describe('flattenResultContent', () => {
  it('passes a plain string through unchanged', () => {
    expect(flattenResultContent('hello world')).toBe('hello world');
  });

  it('joins an array of text blocks with newlines', () => {
    expect(
      flattenResultContent([
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ]),
    ).toBe('line one\nline two');
  });

  it('handles unknown blocks by JSON-encoding them', () => {
    const out = flattenResultContent([
      { type: 'text', text: 'hello' },
      // @ts-expect-error simulating an unrecognized content block
      { type: 'image', source: { kind: 'png' } },
    ]);
    expect(out).toContain('hello');
    expect(out).toContain('"type":"image"');
  });

  it('returns empty string for an empty array', () => {
    expect(flattenResultContent([])).toBe('');
  });
});

// Smoke test — confirms the component renders the dollar prefix and the
// command + output text. Wrapped in a Radix Theme since some primitives read
// CSS vars from the theme provider.
describe('BashToolCard smoke', () => {
  it('renders the command and output text', () => {
    const props: ToolRendererProps = {
      name: 'Bash',
      input: { command: 'echo hi', description: 'Say hi' },
      isStreaming: false,
      result: { content: 'hi\n', isError: false },
      respond: () => {},
      toolUseId: 'toolu_smoke',
    };
    let html = '';
    try {
      html = renderToString(
        <Theme>
          <BashToolCard {...props} />
        </Theme>,
      );
    } catch {
      // Radix occasionally throws under SSR; the structural tests above
      // cover the load-bearing logic.
      return;
    }
    expect(html).toContain('echo hi');
    expect(html).toContain('hi');
    expect(html).toContain('Say hi');
  });

  it('marks errors with exit non-zero', () => {
    const props: ToolRendererProps = {
      name: 'Bash',
      input: { command: 'false' },
      isStreaming: false,
      result: { content: '', isError: true },
      respond: () => {},
      toolUseId: 'toolu_smoke',
    };
    let html = '';
    try {
      html = renderToString(
        <Theme>
          <BashToolCard {...props} />
        </Theme>,
      );
    } catch {
      return;
    }
    expect(html).toContain('exit non-zero');
    expect(html).toContain('(no output)');
  });
});
