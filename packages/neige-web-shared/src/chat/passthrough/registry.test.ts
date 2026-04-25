import { describe, it, expect, beforeEach } from 'vitest';
import {
  passthroughRegistry,
  registerPassthroughRenderer,
  lookupRenderer,
  type PassthroughRenderer,
} from './registry';

const stub: PassthroughRenderer = () => null;

describe('passthrough registry lookup', () => {
  beforeEach(() => {
    passthroughRegistry.clear();
  });

  it('returns null when nothing matches', () => {
    expect(lookupRenderer('hook.pre_tool_use')).toBeNull();
  });

  it('exact match wins over prefix', () => {
    const exact: PassthroughRenderer = () => null;
    const prefix: PassthroughRenderer = () => null;
    registerPassthroughRenderer('hook.', prefix);
    registerPassthroughRenderer('hook.pre_tool_use', exact);
    expect(lookupRenderer('hook.pre_tool_use')).toBe(exact);
  });

  it('falls through to dot-prefix when no exact match', () => {
    registerPassthroughRenderer('hook.', stub);
    expect(lookupRenderer('hook.pre_tool_use')).toBe(stub);
    expect(lookupRenderer('hook.post_tool_use')).toBe(stub);
    expect(lookupRenderer('hook.notification')).toBe(stub);
  });

  it('does not match a different top-level prefix', () => {
    registerPassthroughRenderer('hook.', stub);
    expect(lookupRenderer('rate_limit_event')).toBeNull();
    expect(lookupRenderer('stream.foo')).toBeNull();
  });

  it('walks back through nested dot prefixes', () => {
    registerPassthroughRenderer('a.', stub);
    expect(lookupRenderer('a.b.c')).toBe(stub);
  });

  it('prefers the most specific dot prefix', () => {
    const outer: PassthroughRenderer = () => null;
    const inner: PassthroughRenderer = () => null;
    registerPassthroughRenderer('a.', outer);
    registerPassthroughRenderer('a.b.', inner);
    expect(lookupRenderer('a.b.c')).toBe(inner);
  });
});
