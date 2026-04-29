// Renderer for `neige.ask_user_question` passthrough events.
//
// Emitted by the server-side MCP `ask_question` tool when an inner claude
// asks its own session a question (self-ask), and by the chat runner when
// the Claude SDK invokes the built-in AskUserQuestion tool. The call is
// blocked on our reply: we collect answers and call answerQuestion().
//
// Stays mounted as a regular passthrough card in the chat stream so the
// question + chosen answer are visible in conversation history. The
// component locks itself after submit; subsequent renders show the
// answered state read-only.

import { useState } from 'react';
import { Badge, Box, Button, Flex, Text, TextArea } from '@radix-ui/themes';
import type { PassthroughRendererProps } from './registry';

interface Option {
  label: string;
  description?: string;
  preview?: string;
}

interface Question {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: Option[];
}

interface QuestionPayload {
  question_id: string;
  questions: Question[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function parsePayload(input: unknown): QuestionPayload | null {
  const r = asRecord(input);
  if (!r) return null;
  if (typeof r.question_id !== 'string') return null;

  const parsedQuestions = parseQuestions(r.questions);
  if (!parsedQuestions) return null;
  return { question_id: r.question_id, questions: parsedQuestions };
}

function parseQuestions(input: unknown): Question[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: Question[] = [];
  for (const q of input) {
    const qr = asRecord(q);
    if (!qr || typeof qr.question !== 'string') return null;
    const rawOptions = Array.isArray(qr.options) ? qr.options : [];
    const options: Option[] = [];
    for (const o of rawOptions) {
      const or = asRecord(o);
      if (!or || typeof or.label !== 'string') return null;
      options.push({
        label: or.label,
        description: typeof or.description === 'string' ? or.description : undefined,
        preview: typeof or.preview === 'string' ? or.preview : undefined,
      });
    }
    out.push({
      question: qr.question,
      header: typeof qr.header === 'string' ? qr.header : undefined,
      multiSelect: typeof qr.multiSelect === 'boolean' ? qr.multiSelect : false,
      options,
    });
  }
  return out;
}

export function AskUserQuestionPassthroughCard(props: PassthroughRendererProps) {
  const { payload, answerQuestion } = props;

  const parsed = parsePayload(payload);
  const [singlePicks, setSinglePicks] = useState<Record<number, string>>({});
  const [multiPicks, setMultiPicks] = useState<Record<number, Set<string>>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
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

  const buildAnswers = (): Record<string, string> | null => {
    const answers: Record<string, string> = {};
    for (const [qi, q] of parsed.questions.entries()) {
      const draft = drafts[qi]?.trim();
      const multi = Array.from(multiPicks[qi] ?? []);
      const picked = singlePicks[qi];
      const value = draft || (q.multiSelect ? multi.join(', ') : picked);
      if (!value) return null;
      answers[q.question] = value;
    }
    return answers;
  };

  const submit = () => {
    if (!answerQuestion || submitted !== null) return;
    const built = buildAnswers();
    if (!built) return;
    setSubmitted(summarizeAnswers(built));
    answerQuestion(parsed.question_id, built);
  };

  const canSubmit = canAnswer && buildAnswers() !== null;

  const toggleMulti = (qi: number, label: string) => {
    if (!canAnswer) return;
    setMultiPicks((prev) => {
      const next = { ...prev };
      const set = new Set(next[qi] ?? []);
      if (set.has(label)) set.delete(label);
      else set.add(label);
      next[qi] = set;
      return next;
    });
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
        {parsed.questions.map((q, qi) => {
          const selected = singlePicks[qi];
          const multiSet = multiPicks[qi] ?? new Set<string>();
          return (
            <Flex key={`${qi}:${q.question}`} direction="column" gap="2">
              {q.header && (
                <Text size="1" color="gray" style={{ fontVariant: 'small-caps' }}>
                  {q.header}
                </Text>
              )}
              <Text as="div" size="3" weight="medium">
                {q.question}
              </Text>

              {q.options.length > 0 && (
                <Flex direction="column" gap="2">
                  {q.options.map((opt) => {
                    const isChosen = q.multiSelect
                      ? multiSet.has(opt.label)
                      : selected === opt.label;
                    return (
                      <Button
                        key={opt.label}
                        variant={isChosen ? 'solid' : 'soft'}
                        color={isChosen ? undefined : 'gray'}
                        disabled={!canAnswer}
                        onClick={() =>
                          q.multiSelect
                            ? toggleMulti(qi, opt.label)
                            : setSinglePicks((prev) => ({ ...prev, [qi]: opt.label }))
                        }
                        style={{
                          height: 'auto',
                          padding: '8px 10px',
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                        }}
                      >
                        <Flex direction="column" gap="1" style={{ width: '100%' }}>
                          <Text size="2" weight="bold">
                            {opt.label}
                          </Text>
                          {opt.description && (
                            <Text size="1" color="gray">
                              {opt.description}
                            </Text>
                          )}
                        </Flex>
                      </Button>
                    );
                  })}
                </Flex>
              )}

              {canAnswer && (
                <TextArea
                  placeholder="Type a different answer..."
                  value={drafts[qi] ?? ''}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [qi]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  style={{ minHeight: 56 }}
                />
              )}
            </Flex>
          );
        })}

        {canAnswer && (
          <Button onClick={submit} disabled={!canSubmit} style={{ alignSelf: 'flex-start' }}>
            Submit answer
          </Button>
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

function summarizeAnswers(answers: Record<string, string>): string {
  const entries = Object.entries(answers);
  if (entries.length === 1) return entries[0]?.[1] ?? '';
  return entries.map(([question, answer]) => `${question}: ${answer}`).join('\n');
}
