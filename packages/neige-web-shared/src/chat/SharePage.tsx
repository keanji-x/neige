// Public read-only viewer for a chat-mode session. Mounted at `/share/<token>`
// by App.tsx — the server returns the SPA index.html for that path so this
// component takes over client-side. No auth headers are sent; the share API
// is gated by the unguessable token in the URL.
//
// We fetch two endpoints:
//   - /api/share/<token>/manifest → { session_id, session_title, session_cwd, created_at }
//   - /api/share/<token>/jsonl    → the raw Claude CLI session jsonl
// then run the on-disk events through `jsonlToEvents` and feed them to the
// existing ChatView (with `readOnly` so the compose box and edit affordances
// are hidden).

import { useEffect, useMemo, useState } from 'react';
import { Box, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { ChatView } from './components';
import { jsonlToEvents } from './jsonlToEvents';

export interface SharePageProps {
  token: string;
}

interface ShareManifest {
  session_id: string;
  session_cwd: string;
  session_title: string;
  created_at: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: ShareManifest; jsonl: string }
  | { status: 'error'; code: number | null; message: string };

export function SharePage({ token }: SharePageProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [manifestRes, jsonlRes] = await Promise.all([
          fetch(`/api/share/${encodeURIComponent(token)}/manifest`),
          fetch(`/api/share/${encodeURIComponent(token)}/jsonl`),
        ]);
        if (!manifestRes.ok || !jsonlRes.ok) {
          if (!cancelled) {
            setState({
              status: 'error',
              code: manifestRes.ok ? jsonlRes.status : manifestRes.status,
              message: !manifestRes.ok && manifestRes.status === 404
                ? 'This share link does not exist or has been revoked.'
                : 'Failed to load shared conversation.',
            });
          }
          return;
        }
        const manifest = (await manifestRes.json()) as ShareManifest;
        const jsonl = await jsonlRes.text();
        if (!cancelled) setState({ status: 'ready', manifest, jsonl });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            code: null,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const events = useMemo(
    () => (state.status === 'ready' ? jsonlToEvents(state.jsonl) : []),
    [state],
  );

  if (state.status === 'loading') {
    return (
      <Centered>
        <Text size="2" color="gray">
          Loading shared conversation…
        </Text>
      </Centered>
    );
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <Card>
          <Flex direction="column" gap="2" p="3" align="center">
            <Heading size="3">Cannot open shared chat</Heading>
            <Text size="2" color="gray">
              {state.message}
            </Text>
          </Flex>
        </Card>
      </Centered>
    );
  }

  const { manifest } = state;
  return (
    <Flex direction="column" style={{ height: '100vh', minHeight: 0 }}>
      <Box
        px="4"
        py="2"
        style={{
          borderBottom: '1px solid var(--gray-a4)',
          background: 'var(--color-panel-solid)',
        }}
      >
        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Flex direction="column" gap="1">
            <Heading size="3">{manifest.session_title}</Heading>
            <Text size="1" color="gray">
              Read-only shared conversation · created {formatDate(manifest.created_at)}
            </Text>
          </Flex>
          <Text size="1" color="gray">
            Shared via neige
          </Text>
        </Flex>
      </Box>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ChatView events={events} readOnly />
      </Box>
    </Flex>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ height: '100vh', padding: '24px' }}
    >
      {children}
    </Flex>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
