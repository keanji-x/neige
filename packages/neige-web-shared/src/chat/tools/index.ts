// Public surface for tool_use rendering. Importing this module registers the
// built-in renderers as a side-effect.

import { registerToolRenderer } from './registry';
import { AskUserQuestionCard } from './AskUserQuestionCard';

export type { ToolRenderer, ToolRendererProps } from './registry';
export { toolRegistry, registerToolRenderer, lookupToolRenderer } from './registry';
export { DefaultToolCard } from './DefaultToolCard';
export { AskUserQuestionCard } from './AskUserQuestionCard';

registerToolRenderer('AskUserQuestion', AskUserQuestionCard);
