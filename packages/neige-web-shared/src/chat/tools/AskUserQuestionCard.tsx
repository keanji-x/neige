// Interactive renderer for AskUserQuestion: turns the JSON shape into
// clickable option buttons that send the chosen label back as a user_message.

import { useState } from 'react';
import { Box, Button, Flex, Text } from '@radix-ui/themes';
import { DefaultToolCard } from './DefaultToolCard';
import type { ToolRendererProps } from './registry';

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

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function parseQuestions(input: unknown): Question[] | null {
  const obj = asRecord(input);
  if (!obj || !Array.isArray(obj.questions)) return null;
  const out: Question[] = [];
  for (const q of obj.questions) {
    const qr = asRecord(q);
    if (!qr) return null;
    if (typeof qr.question !== 'string') return null;
    if (typeof qr.multiSelect !== 'boolean') return null;
    if (!Array.isArray(qr.options)) return null;
    const options: Option[] = [];
    for (const o of qr.options) {
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
      multiSelect: qr.multiSelect,
      options,
    });
  }
  return out;
}

export function AskUserQuestionCard(props: ToolRendererProps) {
  const { input, isStreaming, result, respond } = props;

  const [singlePicks, setSinglePicks] = useState<Record<number, string>>({});
  const [multiPicks, setMultiPicks] = useState<Record<number, Set<string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  if (isStreaming) {
    return (
      <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
        Loading question…
      </Text>
    );
  }

  const questions = parseQuestions(input);
  if (!questions) return <DefaultToolCard {...props} />;

  // claude --print auto-fails AskUserQuestion (no interactive surface in the
  // CLI tool harness), so a result is almost always present and almost always
  // an error. Show it inline but keep the buttons live — clicking still sends
  // a user_message that claude can act on next turn.

  const anyMulti = questions.some((q) => q.multiSelect);

  const onSinglePick = (qi: number, label: string) => {
    if (singlePicks[qi] || submitted) return;
    setSinglePicks((p) => ({ ...p, [qi]: label }));
    setSentNote(label);
    respond(label);
  };

  const toggleMulti = (qi: number, label: string) => {
    if (submitted) return;
    setMultiPicks((p) => {
      const next = { ...p };
      const set = new Set(next[qi] ?? []);
      if (set.has(label)) set.delete(label);
      else set.add(label);
      next[qi] = set;
      return next;
    });
  };

  const onSubmitMulti = () => {
    if (submitted) return;
    const all: string[] = [];
    questions.forEach((q, qi) => {
      if (q.multiSelect) {
        for (const l of multiPicks[qi] ?? []) all.push(l);
      } else if (singlePicks[qi]) {
        all.push(singlePicks[qi]);
      }
    });
    setSubmitted(true);
    setSentNote(JSON.stringify(all));
    respond(JSON.stringify(all));
  };

  return (
    <Flex direction="column" gap="3">
      {result && result.isError && (
        <Box
          px="2"
          py="1"
          style={{
            borderRadius: 'var(--radius-2)',
            background: 'var(--gray-a3)',
            border: '1px solid var(--gray-a4)',
          }}
        >
          <Text size="1" color="gray">
            CLI auto-rejected the prompt — pick an option below to answer manually.
          </Text>
        </Box>
      )}
      {questions.map((q, qi) => {
        const chosen = singlePicks[qi];
        const multiSet = multiPicks[qi] ?? new Set<string>();
        const locked = submitted || (!q.multiSelect && !!chosen);
        return (
          <Box key={qi}>
            {q.header && (
              <Text size="1" color="gray" style={{ fontVariant: 'small-caps' }}>
                {q.header}
              </Text>
            )}
            <Text as="div" size="2" weight="medium" mt="1" mb="2">
              {q.question}
            </Text>
            <Flex direction="column" gap="2">
              {q.options.map((opt) => {
                const isChosen = q.multiSelect ? multiSet.has(opt.label) : chosen === opt.label;
                return (
                  <Button
                    key={opt.label}
                    variant={isChosen ? 'solid' : 'soft'}
                    color={isChosen ? undefined : 'gray'}
                    disabled={locked && !isChosen}
                    onClick={() =>
                      q.multiSelect ? toggleMulti(qi, opt.label) : onSinglePick(qi, opt.label)
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
          </Box>
        );
      })}
      {anyMulti && (
        <Button onClick={onSubmitMulti} disabled={submitted} style={{ alignSelf: 'flex-start' }}>
          Submit
        </Button>
      )}
      {sentNote && (
        <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
          Sent: {sentNote}
        </Text>
      )}
    </Flex>
  );
}
