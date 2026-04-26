// Barrel for chat UI components. Both `web/` and `web-mobile/` consume these
// via `@neige/shared` so the rendered chat surface stays in lockstep across
// desktop and mobile.

export { ChatView } from './ChatView';
export { ChatTimelineView } from './ChatTimelineView';
export { MessageBubble } from './MessageBubble';
export { TextBlock } from './TextBlock';
export { ThinkingBlock } from './ThinkingBlock';
export { ToolUseBlock } from './ToolUseBlock';
export { ToolResultBlock } from './ToolResultBlock';
export { ComposeBox } from './ComposeBox';
export { mockEvents } from './mockEvents';
