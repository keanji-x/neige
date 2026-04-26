import { describe, it, expect } from 'vitest';
import { parseEditInput } from './EditToolCard';

describe('parseEditInput', () => {
  it('parses a complete input', () => {
    const out = parseEditInput({
      file_path: '/a/b.ts',
      old_string: 'foo',
      new_string: 'bar',
      replace_all: true,
    });
    expect(out).toEqual({
      file_path: '/a/b.ts',
      old_string: 'foo',
      new_string: 'bar',
      replace_all: true,
    });
  });

  it('treats missing old_string / new_string as empty (streaming-tolerant)', () => {
    const out = parseEditInput({ file_path: '/a/b.ts' });
    expect(out).toEqual({
      file_path: '/a/b.ts',
      old_string: '',
      new_string: '',
      replace_all: false,
    });
  });

  it('returns null when file_path is missing', () => {
    expect(parseEditInput({ old_string: 'a', new_string: 'b' })).toBeNull();
  });

  it('returns null when file_path has the wrong type', () => {
    expect(parseEditInput({ file_path: 42 })).toBeNull();
  });

  it('returns null when old_string is the wrong type', () => {
    expect(parseEditInput({ file_path: '/a', old_string: 42 })).toBeNull();
  });

  it('returns null when replace_all is the wrong type', () => {
    expect(parseEditInput({ file_path: '/a', replace_all: 'yes' })).toBeNull();
  });

  it('returns null for non-objects', () => {
    expect(parseEditInput(null)).toBeNull();
    expect(parseEditInput('hello')).toBeNull();
    expect(parseEditInput([])).toBeNull();
  });
});
