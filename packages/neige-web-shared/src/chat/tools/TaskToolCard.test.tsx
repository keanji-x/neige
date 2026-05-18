import { describe, it, expect } from 'vitest';
import { parseTaskInput } from './TaskToolCard';

describe('parseTaskInput', () => {
  it('accepts a fully-specified payload', () => {
    expect(
      parseTaskInput({
        description: 'find usages',
        prompt: 'Search for foo and report.',
        subagent_type: 'general-purpose',
      }),
    ).toEqual({
      description: 'find usages',
      prompt: 'Search for foo and report.',
      subagent_type: 'general-purpose',
    });
  });

  it('returns null when input is not an object', () => {
    expect(parseTaskInput(null)).toBeNull();
    expect(parseTaskInput('x')).toBeNull();
    expect(parseTaskInput([])).toBeNull();
    expect(parseTaskInput(undefined)).toBeNull();
  });

  it('returns null when any required field is missing', () => {
    expect(parseTaskInput({ prompt: 'p', subagent_type: 's' })).toBeNull();
    expect(parseTaskInput({ description: 'd', subagent_type: 's' })).toBeNull();
    expect(parseTaskInput({ description: 'd', prompt: 'p' })).toBeNull();
  });

  it('returns null when any required field has wrong type', () => {
    expect(
      parseTaskInput({ description: 1, prompt: 'p', subagent_type: 's' }),
    ).toBeNull();
    expect(
      parseTaskInput({ description: 'd', prompt: 2, subagent_type: 's' }),
    ).toBeNull();
    expect(
      parseTaskInput({ description: 'd', prompt: 'p', subagent_type: false }),
    ).toBeNull();
  });

  it('ignores extra unknown fields', () => {
    expect(
      parseTaskInput({
        description: 'd',
        prompt: 'p',
        subagent_type: 's',
        extra: 'ignored',
      }),
    ).toEqual({ description: 'd', prompt: 'p', subagent_type: 's' });
  });
});
