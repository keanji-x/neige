// Stub vitest tests for the useChatSession hook. Like derive.test.ts these
// are written framework-agnostic — no jest-dom matchers, no @testing-library
// imports — so wiring vitest later is purely runner setup. The substantive
// hook behavior (WS lifecycle, reconnect, hello disambiguation) is exercised
// via integration on a fake WS in a follow-up; the assertions here are
// purely smoke-level shape checks.

import { describe, it, expect } from 'vitest';
import { useChatSession } from './useChatSession';
import type {
  ChatSessionStatus,
  UseChatSessionApi,
  UseChatSessionOptions,
} from './useChatSession';

describe('useChatSession', () => {
  it('exports a function', () => {
    expect(typeof useChatSession).toBe('function');
  });

  it('exposes the documented option shape', () => {
    // Type-only assertion — `_check` deliberately unused, this is here so
    // changes to the public option surface trigger a TS error.
    const _check: UseChatSessionOptions = { sessionId: null };
    void _check;
  });

  it('returns the documented api shape', () => {
    type Status = ChatSessionStatus;
    const _ok: Status[] = ['connecting', 'open', 'closed', 'reconnecting'];
    void _ok;
    type _Api = UseChatSessionApi;
    void _ok;
  });
});
