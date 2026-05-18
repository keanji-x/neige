import { describe, it, expect } from 'vitest';
import { shortenPath, lineCount } from './filePath';

describe('shortenPath', () => {
  it('returns short paths unchanged', () => {
    expect(shortenPath('/a/b/c.ts')).toBe('/a/b/c.ts');
    expect(shortenPath('foo.ts', 10)).toBe('foo.ts');
  });

  it('keeps the last two segments and replaces the head with …/', () => {
    const out = shortenPath('/home/kenji/neige/crates/foo/bar/baz.rs', 32);
    expect(out).toBe('…/bar/baz.rs');
    expect(out.length).toBeLessThanOrEqual(32);
  });

  it('falls back to head-truncating the basename when even tail exceeds max', () => {
    // Basename alone of length 60, max 20 — must end with the basename's tail.
    const longBase = 'x'.repeat(60);
    const out = shortenPath(`/a/b/${longBase}`, 20);
    expect(out.startsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith(longBase.slice(longBase.length - 19))).toBe(true);
  });

  it('handles a path with only a basename', () => {
    const out = shortenPath('a'.repeat(100), 10);
    expect(out.startsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it('handles a path with one parent + basename when over max', () => {
    const out = shortenPath('/' + 'a'.repeat(80) + '/b.ts', 16);
    // Two segments path means there is no head to elide; we head-truncate the
    // basename instead.
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out.endsWith('b.ts')).toBe(true);
  });

  it('returns empty string for empty input', () => {
    expect(shortenPath('')).toBe('');
  });
});

describe('lineCount', () => {
  it('returns 0 for empty', () => {
    expect(lineCount('')).toBe(0);
  });

  it('counts a single line with no trailing newline', () => {
    expect(lineCount('hello')).toBe(1);
  });

  it('counts multiple newlines without a trailing newline', () => {
    expect(lineCount('a\nb\nc')).toBe(3);
  });

  it('does not over-count a trailing newline', () => {
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('a\n')).toBe(1);
  });
});
