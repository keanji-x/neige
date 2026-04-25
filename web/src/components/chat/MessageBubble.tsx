// One conversational turn. User messages get a right-aligned tinted card;
// assistant messages render their AssistantBlock stack edge-to-edge so the
// reader's eye lands on content, not chrome.

import { Box, Card, Flex, Text } from '@radix-ui/themes';
import type { AssistantBlock, ChatMessage, ContentBlock, ToolResultsById } from '@neige/shared';
import { TextBlock } from './TextBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolUseBlock } from './ToolUseBlock';

interface MessageBubbleProps {
  message: ChatMessage;
  toolResults: ToolResultsById;
}

export function MessageBubble({ message, toolResults }: MessageBubbleProps) {
  if (message.role === 'user') {
    return <UserBubble blocks={message.blocks} />;
  }
  return (
    <AssistantTurn
      blocks={message.blocks}
      toolResults={toolResults}
      isComplete={message.isComplete}
    />
  );
}

function UserBubble({ blocks }: { blocks: ContentBlock[] }) {
  const text = blocks
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_result') return ''; // user-side tool_result, skip
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  return (
    <Flex justify="end" mb="3">
      <Card
        variant="surface"
        style={{
          maxWidth: '80%',
          background: 'var(--accent-a3)',
          borderColor: 'var(--accent-a5)',
        }}
      >
        <Text as="div" size="2" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
          {text}
        </Text>
      </Card>
    </Flex>
  );
}

function AssistantTurn({
  blocks,
  toolResults,
  isComplete,
}: {
  blocks: AssistantBlock[];
  toolResults: ToolResultsById;
  isComplete: boolean;
}) {
  return (
    <Box mb="4">
      <Flex direction="column" gap="3">
        {blocks.map((block) => {
          switch (block.type) {
            case 'text':
              return (
                <TextBlock
                  key={block.index}
                  text={block.text}
                  isStreaming={block.isStreaming && !isComplete}
                />
              );
            case 'thinking':
              return (
                <ThinkingBlock
                  key={block.index}
                  text={block.text}
                  isStreaming={block.isStreaming}
                />
              );
            case 'tool_use':
              return (
                <ToolUseBlock
                  key={block.index}
                  name={block.name}
                  input={block.input}
                  isStreaming={block.isStreaming}
                  result={toolResults[block.toolUseId]}
                />
              );
            case 'unknown':
              return (
                <Text key={block.index} size="1" color="gray">
                  [unknown block]
                </Text>
              );
            default:
              return null;
          }
        })}
      </Flex>
    </Box>
  );
}
