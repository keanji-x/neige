import { describe, it, expect } from 'vitest';
import { parseGlobInput, countNonEmptyLines } from './GlobToolCard';

describe('parseGlobInput', () => {
  it('accepts a minimal pattern-only payload', () => {
    expect(parseGlobInput({ pattern: '**/*.ts' })).toEqual({ pattern: '**/*.ts' });
  });

  it('parses pattern + path', () => {
    expect(parseGlobInput({ pattern: '*.rs', path: '/repo' })).toEqual({
      pattern: '*.rs',
      path: '/repo',
    });
  });

  it('returns null when input is not an object', () => {
    expect(parseGlobInput(null)).toBeNull();
    expect(parseGlobInput('x')).toBeNull();
    expect(parseGlobInput([])).toBeNull();
    expect(parseGlobInput(undefined)).toBeNull();
  });

  it('returns null when pattern is missing', () => {
    expect(parseGlobInput({})).toBeNull();
    expect(parseGlobInput({ path: '/x' })).toBeNull();
  });

  it('returns null when pattern is wrong type', () => {
    expect(parseGlobInput({ pattern: 42 })).toBeNull();
    expect(parseGlobInput({ pattern: null })).toBeNull();
  });

  it('drops a non-string path', () => {
    expect(parseGlobInput({ pattern: 'x', path: 5 })).toEqual({ pattern: 'x' });
  });
});

describe('countNonEmptyLines', () => {
  it('returns 0 for empty input', () => {
    expect(countNonEmptyLines('')).toBe(0);
  });

  it('counts a single line', () => {
    expect(countNonEmptyLines('a/b.ts')).toBe(1);
  });

  it('ignores blank lines and pure whitespace', () => {
    expect(countNonEmptyLines('a\n\nb\n   \nc\n')).toBe(3);
  });

  it('counts trailing-newline-free input', () => {
    expect(countNonEmptyLines('one\ntwo\nthree')).toBe(3);
  });
});
