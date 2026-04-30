import { describe, it, expect, beforeEach } from 'vitest';
import {
  toolRegistry,
  registerToolRenderer,
  lookupToolRenderer,
  lookupToolMeta,
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

describe('tool registry meta', () => {
  beforeEach(() => {
    toolRegistry.clear();
  });

  it('returns empty meta when not registered', () => {
    expect(lookupToolMeta('Anything')).toEqual({});
  });

  it('returns empty meta when registered without options', () => {
    registerToolRenderer('Bash', stub);
    expect(lookupToolMeta('Bash')).toEqual({});
  });

  it('round-trips defaultOpen=true', () => {
    registerToolRenderer('TodoWrite', stub, { defaultOpen: true });
    expect(lookupToolMeta('TodoWrite')).toEqual({ defaultOpen: true });
  });

  it('register overwrites previous meta', () => {
    registerToolRenderer('TodoWrite', stub, { defaultOpen: true });
    registerToolRenderer('TodoWrite', stub, {});
    expect(lookupToolMeta('TodoWrite')).toEqual({});
  });
});
