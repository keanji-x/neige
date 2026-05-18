import { useCallback, useEffect, useState } from 'react';
import { createConversation, listConversations } from '@neige/shared/api';
// listConversations is still used by the demo auto-bind below.
import { Icon } from './Icon';
import { Sidebar, TitleBar } from './ui';
import { CovePage, TodayPage, WavePage } from './pages';
import { coves as seedCoves, waves as seedWaves } from './data';
import type { Route, Wave, WaveCardData } from './types';
import type { AddPanelKind } from './ui';

// Fold seeded `wave.plan` into `wave.cards` (plan becomes a regular card),
// mirroring the design's seedWaves() in app.jsx.
function withFoldedPlans(waves: Wave[]): Wave[] {
  return waves.map((w) => {
    if (!w.plan || w.plan.length === 0) {
      return { ...w, plan: undefined };
    }
    return {
      ...w,
      plan: undefined,
      cards: [...(w.cards || []), { type: 'plan', steps: w.plan }],
    };
  });
}

function newCard(type: AddPanelKind): WaveCardData | null {
  if (type === 'terminal')
    return {
      type: 'terminal',
      title: 'new terminal',
      lines: [{ kind: 'log', text: 'empty session — panel ready.' }],
    };
  if (type === 'doc') return { type: 'doc', title: 'New note', body: 'Start typing…' };
  if (type === 'plan') return { type: 'plan', steps: [{ label: 'Add a step…', cur: true }] };
  return null;
}

export function CalmApp() {
  const [route, setRoute] = useState<Route>({ name: 'today' });
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [waves, setWaves] = useState<Wave[]>(() => withFoldedPlans(seedWaves));

  const coves = seedCoves;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  // Demo wire: on mount, fetch real conversations from neige-server and bind
  // the first non-dead one to w-001's first terminal card. Proves the Calm
  // terminal card can host a live PTY without redesigning the data flow.
  // Falls back silently to mock lines if the server is unreachable.
  useEffect(() => {
    let cancelled = false;
    listConversations()
      .then((cs) => {
        if (cancelled) return;
        const live = cs.find((c) => c.status !== 'dead');
        if (!live) return;
        setWaves((ws) =>
          ws.map((w) => {
            if (w.id !== 'w-001') return w;
            return {
              ...w,
              cards: (w.cards || []).map((c, i) =>
                i === 0 && c.type === 'terminal' ? { ...c, convId: live.id } : c,
              ),
            };
          }),
        );
      })
      .catch(() => { /* server not running — stay on mock */ });
    return () => { cancelled = true; };
  }, []);

  const findWave = (id: string) => waves.find((w) => w.id === id) || null;
  const findCove = (id: string) => coves.find((c) => c.id === id) || null;

  const go = useCallback((r: Route) => setRoute(r), []);

  const addCard = useCallback(async (waveId: string, type: AddPanelKind) => {
    // Non-terminal cards stay client-side mock for now (doc / plan have no
    // backend storage yet — they'll arrive with the MCP plugin layer).
    if (type !== 'terminal') {
      const c = newCard(type);
      if (!c) return;
      setWaves((ws) =>
        ws.map((w) => (w.id === waveId ? { ...w, cards: [...(w.cards || []), c] } : w)),
      );
      return;
    }

    // Terminal cards spin up a real conversation. Server takes empty cwd +
    // program as "use $HOME / $SHELL" — a clean new shell, not inherited
    // from any other conv. Falls back to a mock card if the server is down.
    try {
      const created = await createConversation({
        title: 'new terminal',
        program: '',
        cwd: '',
        use_worktree: false,
      });
      setWaves((ws) =>
        ws.map((w) =>
          w.id === waveId
            ? {
                ...w,
                cards: [
                  ...(w.cards || []),
                  {
                    type: 'terminal',
                    title: 'new terminal',
                    lines: [],
                    convId: created.id,
                  },
                ],
              }
            : w,
        ),
      );
    } catch (err) {
      console.warn('[Calm] terminal create fell back to mock:', err);
      const c = newCard('terminal');
      if (!c) return;
      setWaves((ws) =>
        ws.map((w) => (w.id === waveId ? { ...w, cards: [...(w.cards || []), c] } : w)),
      );
    }
  }, []);

  const removeCard = useCallback((waveId: string, idx: number) => {
    setWaves((ws) =>
      ws.map((w) =>
        w.id === waveId
          ? { ...w, cards: (w.cards || []).filter((_, i) => i !== idx) }
          : w,
      ),
    );
  }, []);

  const moveCardTo = useCallback((waveId: string, from: number, to: number) => {
    if (from === to) return;
    setWaves((ws) =>
      ws.map((w) => {
        if (w.id !== waveId) return w;
        const cards = (w.cards || []).slice();
        if (from < 0 || from >= cards.length) return w;
        const [moved] = cards.splice(from, 1);
        const insertAt = Math.max(0, Math.min(cards.length, to));
        cards.splice(insertAt, 0, moved);
        return { ...w, cards };
      }),
    );
  }, []);

  const renderPage = () => {
    if (route.name === 'today') {
      return <TodayPage waves={waves} coves={coves} onGo={go} />;
    }
    if (route.name === 'cove') {
      const cove = findCove(route.coveId);
      if (!cove) return <Missing label="Cove" onGo={go} />;
      return (
        <CovePage
          cove={cove}
          waves={waves.filter((w) => w.coveId === cove.id)}
          onGo={go}
        />
      );
    }
    if (route.name === 'wave') {
      const wave = findWave(route.id);
      if (!wave) return <Missing label="Wave" onGo={go} />;
      const cove = findCove(wave.coveId);
      if (!cove) return <Missing label="Cove" onGo={go} />;
      return (
        <WavePage
          wave={wave}
          cove={cove}
          onGo={go}
          onAddCard={addCard}
          onRemoveCard={removeCard}
          onMoveCard={moveCardTo}
        />
      );
    }
    return <Missing label="Page" onGo={go} />;
  };

  return (
    <div className="win">
      <TitleBar
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />
      <div className="stage">
        <Sidebar coves={coves} waves={waves} route={route} onGo={go} />
        <main className="page">
          <div className="scroll">{renderPage()}</div>
        </main>
      </div>
    </div>
  );
}

function Missing({ label, onGo }: { label: string; onGo: (r: Route) => void }) {
  return (
    <div className="col">
      <p className="synth">That {label} isn't here anymore.</p>
      <button
        className="go outline"
        onClick={() => onGo({ name: 'today' })}
        style={{ alignSelf: 'flex-start' }}
      >
        <Icon n="back" s={13} /> Back to Today
      </button>
    </div>
  );
}

export default CalmApp;
