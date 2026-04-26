// Public surface for tool_use rendering. Importing this module registers the
// built-in renderers as a side-effect — one entry per Claude Code tool we
// have a TUI-aligned card for. Anything not listed here falls through to
// DefaultToolCard.

import { registerToolRenderer } from './registry';
import { AskUserQuestionCard } from './AskUserQuestionCard';
import { TodoWriteToolCard } from './TodoWriteToolCard';
import { BashToolCard } from './BashToolCard';
import { EditToolCard } from './EditToolCard';
import { WriteToolCard } from './WriteToolCard';
import { ReadToolCard } from './ReadToolCard';
import { GrepToolCard } from './GrepToolCard';
import { GlobToolCard } from './GlobToolCard';
import { TaskToolCard } from './TaskToolCard';

export type { ToolRenderer, ToolRendererProps } from './registry';
export { toolRegistry, registerToolRenderer, lookupToolRenderer } from './registry';
export { DefaultToolCard } from './DefaultToolCard';
export { AskUserQuestionCard } from './AskUserQuestionCard';
export { TodoWriteToolCard } from './TodoWriteToolCard';
export { BashToolCard } from './BashToolCard';
export { EditToolCard } from './EditToolCard';
export { WriteToolCard } from './WriteToolCard';
export { ReadToolCard } from './ReadToolCard';
export { GrepToolCard } from './GrepToolCard';
export { GlobToolCard } from './GlobToolCard';
export { TaskToolCard } from './TaskToolCard';

registerToolRenderer('AskUserQuestion', AskUserQuestionCard);
registerToolRenderer('TodoWrite', TodoWriteToolCard);
registerToolRenderer('Bash', BashToolCard);
registerToolRenderer('Edit', EditToolCard);
registerToolRenderer('Write', WriteToolCard);
registerToolRenderer('Read', ReadToolCard);
registerToolRenderer('Grep', GrepToolCard);
registerToolRenderer('Glob', GlobToolCard);
registerToolRenderer('Task', TaskToolCard);
