import { describe, it, expect, beforeEach } from 'vitest';
import {
  toolRegistry,
  registerToolRenderer,
  lookupToolRenderer,
  type ToolRenderer,
} from './registry';

const stub: ToolRenderer = () => null;

describe('tool registry lookup', () => {
  beforeEach(() => {
    toolRegistry.clear();
  });

  it('returns null when nothing matches', () => {
    expect(lookupToolRenderer('Bash')).toBeNull();
  });

  it('exact match returns the registered renderer', () => {
    registerToolRenderer('AskUserQuestion', stub);
    expect(lookupToolRenderer('AskUserQuestion')).toBe(stub);
  });

  it('does not match by prefix', () => {
    registerToolRenderer('Ask', stub);
    expect(lookupToolRenderer('AskUserQuestion')).toBeNull();
  });

  it('register overwrites previous renderer', () => {
    const a: ToolRenderer = () => null;
    const b: ToolRenderer = () => null;
    registerToolRenderer('Bash', a);
    registerToolRenderer('Bash', b);
    expect(lookupToolRenderer('Bash')).toBe(b);
  });
});
