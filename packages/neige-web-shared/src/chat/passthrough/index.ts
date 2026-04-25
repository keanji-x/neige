// Public surface for passthrough rendering. Importing this module registers
// the built-in renderers as a side-effect.

import { registerPassthroughRenderer } from './registry';
import { HookEventCard } from './HookEventCard';

export type { PassthroughRenderer } from './registry';
export {
  passthroughRegistry,
  registerPassthroughRenderer,
  lookupRenderer,
} from './registry';
export { DefaultPassthroughCard } from './DefaultPassthroughCard';
export { HookEventCard } from './HookEventCard';

registerPassthroughRenderer('hook.', HookEventCard);
