import { describe, it, expect } from 'vitest';
import { parseWriteInput } from './WriteToolCard';

describe('parseWriteInput', () => {
  it('parses a complete input', () => {
    expect(parseWriteInput({ file_path: '/a/b.ts', content: 'hello' })).toEqual({
      file_path: '/a/b.ts',
      content: 'hello',
    });
  });

  it('treats missing content as empty (streaming-tolerant)', () => {
    expect(parseWriteInput({ file_path: '/a/b.ts' })).toEqual({
      file_path: '/a/b.ts',
      content: '',
    });
  });

  it('returns null when file_path is missing', () => {
    expect(parseWriteInput({ content: 'x' })).toBeNull();
  });

  it('returns null when content has the wrong type', () => {
    expect(parseWriteInput({ file_path: '/a', content: 42 })).toBeNull();
  });

  it('returns null for non-objects', () => {
    expect(parseWriteInput(null)).toBeNull();
    expect(parseWriteInput([])).toBeNull();
    expect(parseWriteInput('x')).toBeNull();
  });
});
