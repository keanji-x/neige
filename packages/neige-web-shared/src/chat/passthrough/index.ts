// Public surface for passthrough rendering. Importing this module registers
// the built-in renderers as a side-effect.

import { registerPassthroughRenderer } from './registry';
import { HookEventCard } from './HookEventCard';
import { AskUserQuestionPassthroughCard } from './AskUserQuestionPassthroughCard';

export type { PassthroughRenderer, PassthroughRendererProps } from './registry';
export {
  passthroughRegistry,
  registerPassthroughRenderer,
  lookupRenderer,
} from './registry';
export { DefaultPassthroughCard } from './DefaultPassthroughCard';
export { HookEventCard } from './HookEventCard';
export { AskUserQuestionPassthroughCard } from './AskUserQuestionPassthroughCard';

registerPassthroughRenderer('hook.', HookEventCard);
registerPassthroughRenderer('neige.ask_user_question', AskUserQuestionPassthroughCard);
