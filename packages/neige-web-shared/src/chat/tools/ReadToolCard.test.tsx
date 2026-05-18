import { describe, it, expect } from 'vitest';
import { parseReadInput } from './ReadToolCard';

describe('parseReadInput', () => {
  it('parses a minimal input (just file_path)', () => {
    expect(parseReadInput({ file_path: '/a/b.ts' })).toEqual({
      file_path: '/a/b.ts',
      offset: undefined,
      limit: undefined,
      pages: undefined,
    });
  });

  it('parses offset / limit / pages', () => {
    expect(
      parseReadInput({ file_path: '/a/b.ts', offset: 10, limit: 50, pages: '1-5' }),
    ).toEqual({
      file_path: '/a/b.ts',
      offset: 10,
      limit: 50,
      pages: '1-5',
    });
  });

  it('returns null when file_path is missing', () => {
    expect(parseReadInput({ offset: 0 })).toBeNull();
  });

  it('returns null when offset is the wrong type', () => {
    expect(parseReadInput({ file_path: '/a', offset: '0' })).toBeNull();
  });

  it('returns null when limit is the wrong type', () => {
    expect(parseReadInput({ file_path: '/a', limit: '5' })).toBeNull();
  });

  it('returns null when pages is the wrong type', () => {
    expect(parseReadInput({ file_path: '/a', pages: 5 })).toBeNull();
  });

  it('returns null for non-objects', () => {
    expect(parseReadInput(null)).toBeNull();
    expect(parseReadInput([])).toBeNull();
    expect(parseReadInput('x')).toBeNull();
  });
});
