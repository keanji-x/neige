import { describe, it, expect } from 'vitest';
import { parseGrepInput } from './GrepToolCard';

describe('parseGrepInput', () => {
  it('accepts a minimal pattern-only payload', () => {
    expect(parseGrepInput({ pattern: 'foo' })).toEqual({ pattern: 'foo' });
  });

  it('returns null when input is not an object', () => {
    expect(parseGrepInput(null)).toBeNull();
    expect(parseGrepInput('foo')).toBeNull();
    expect(parseGrepInput(['pattern'])).toBeNull();
    expect(parseGrepInput(undefined)).toBeNull();
  });

  it('returns null when pattern is missing', () => {
    expect(parseGrepInput({})).toBeNull();
    expect(parseGrepInput({ path: '/x' })).toBeNull();
  });

  it('returns null when pattern is wrong type', () => {
    expect(parseGrepInput({ pattern: 42 })).toBeNull();
    expect(parseGrepInput({ pattern: null })).toBeNull();
  });

  it('parses path / glob / type / output_mode', () => {
    expect(
      parseGrepInput({
        pattern: 'fn',
        path: '/repo',
        glob: '*.rs',
        type: 'rust',
        output_mode: 'content',
      }),
    ).toEqual({
      pattern: 'fn',
      path: '/repo',
      glob: '*.rs',
      type: 'rust',
      output_mode: 'content',
    });
  });

  it('rejects unknown output_mode', () => {
    const r = parseGrepInput({ pattern: 'x', output_mode: 'bogus' });
    expect(r).toEqual({ pattern: 'x' });
  });

  it('parses hyphenated boolean flags', () => {
    const r = parseGrepInput({ pattern: 'x', '-i': true, '-n': true, multiline: true });
    expect(r?.caseInsensitive).toBe(true);
    expect(r?.showLineNumbers).toBe(true);
    expect(r?.multiline).toBe(true);
  });

  it('parses context numbers', () => {
    const r = parseGrepInput({ pattern: 'x', '-A': 2, '-B': 1, '-C': 3, head_limit: 50 });
    expect(r?.afterContext).toBe(2);
    expect(r?.beforeContext).toBe(1);
    expect(r?.context).toBe(3);
    expect(r?.head_limit).toBe(50);
  });

  it('drops fields with the wrong scalar type', () => {
    const r = parseGrepInput({
      pattern: 'x',
      path: 42,
      glob: true,
      '-i': 'yes',
      '-A': '2',
    });
    expect(r).toEqual({ pattern: 'x' });
  });
});
