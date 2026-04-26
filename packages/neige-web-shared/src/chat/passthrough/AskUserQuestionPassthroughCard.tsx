// Renderer for `neige.ask_user_question` passthrough events.
//
// Emitted by the server-side MCP `ask_question` tool when an inner claude
// asks its own session a question (self-ask). The MCP call is blocked on
// our reply: we collect a free-form answer (or a clicked option) and call
// `answerQuestion(question_id, answer)` to resolve the server-side oneshot
// and unblock the tool.
//
// Stays mounted as a regular passthrough card in the chat stream so the
// question + chosen answer are visible in conversation history. The
// component locks itself after submit; subsequent renders show the
// answered state read-only.

import { useState } from 'react';
import { Badge, Box, Button, Flex, Text, TextArea } from '@radix-ui/themes';
import type { PassthroughRendererProps } from './registry';

interface QuestionPayload {
  question_id: string;
  question: string;
  options: string[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function parsePayload(input: unknown): QuestionPayload | null {
  const r = asRecord(input);
  if (!r) return null;
  if (typeof r.question_id !== 'string' || typeof r.question !== 'string') return null;
  const options = Array.isArray(r.options)
    ? r.options.filter((o): o is string => typeof o === 'string')
    : [];
  return { question_id: r.question_id, question: r.question, options };
}

export function AskUserQuestionPassthroughCard(props: PassthroughRendererProps) {
  const { payload, answerQuestion } = props;

  const parsed = parsePayload(payload);
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);

  if (!parsed) {
    return (
      <Box
        my="2"
        px="3"
        py="2"
        style={{
          borderRadius: 'var(--radius-3)',
          background: 'var(--gray-a3)',
          border: '1px solid var(--gray-a4)',
        }}
      >
        <Text size="1" color="gray">
          (malformed neige.ask_user_question payload)
        </Text>
      </Box>
    );
  }

  // Static / preview mounts (no live WS) leave answerQuestion undefined.
  // Render the question read-only in that case so it still appears in the
  // transcript without a broken submit button.
  const canAnswer = !!answerQuestion && submitted === null;

  const submit = (answer: string) => {
    if (!answerQuestion || submitted !== null) return;
    const trimmed = answer.trim();
    if (trimmed.length === 0) return;
    setSubmitted(trimmed);
    answerQuestion(parsed.question_id, trimmed);
  };

  return (
    <Box
      my="3"
      px="3"
      py="3"
      style={{
        borderRadius: 'var(--radius-3)',
        background: 'var(--accent-a2)',
        border: '1px solid var(--accent-a5)',
      }}
    >
      <Flex direction="column" gap="2">
        <Flex gap="2" align="center">
          <Badge color="amber" variant="soft">
            ask
          </Badge>
          <Text size="1" color="gray">
            The session is asking you to answer.
          </Text>
        </Flex>
        <Text as="div" size="3" weight="medium">
          {parsed.question}
        </Text>

        {parsed.options.length > 0 && (
          <Flex gap="2" wrap="wrap">
            {parsed.options.map((opt) => (
              <Button
                key={opt}
                variant={submitted === opt ? 'solid' : 'soft'}
                color={submitted === opt ? undefined : 'gray'}
                disabled={!canAnswer}
                onClick={() => submit(opt)}
              >
                {opt}
              </Button>
            ))}
          </Flex>
        )}

        {canAnswer && (
          <Flex direction="column" gap="2">
            <TextArea
              placeholder="Type your answer (Cmd/Ctrl+Enter to submit)…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  submit(draft);
                }
              }}
              style={{ minHeight: 60 }}
            />
            <Button
              onClick={() => submit(draft)}
              disabled={draft.trim().length === 0}
              style={{ alignSelf: 'flex-start' }}
            >
              Submit answer
            </Button>
          </Flex>
        )}

        {submitted !== null && (
          <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
            Answered: {submitted}
          </Text>
        )}

        {!answerQuestion && submitted === null && (
          <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
            (read-only preview — no live connection to answer)
          </Text>
        )}
      </Flex>
    </Box>
  );
}
