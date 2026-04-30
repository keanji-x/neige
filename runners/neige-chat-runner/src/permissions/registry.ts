/**
 * Tool permission handler registry — same shape as MS's
 * `registerToolPermissionHandler` / `getToolPermissionHandlerRegistry`.
 *
 * Handlers self-register at module load (see `askUserQuestion.ts`); the
 * dispatcher in `cli.ts` calls `lookup(toolName)` to find the right one.
 */
import type { ToolPermissionHandler } from './types.js';

const handlers: ToolPermissionHandler[] = [];

export function register(handler: ToolPermissionHandler): void {
  handlers.push(handler);
}

export function lookup(toolName: string): ToolPermissionHandler | undefined {
  return handlers.find((h) => h.toolNames.includes(toolName));
}

/** Test-only: drop all registrations so each test starts from a clean slate. */
export function _resetRegistryForTests(): void {
  handlers.length = 0;
}
