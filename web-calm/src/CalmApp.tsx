import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Sidebar, TitleBar } from './ui';
import { CovePage, TodayPage, WavePage } from './pages';
import { adaptCard, adaptCove, adaptWave } from './api/adapt';
import { useKernel } from './hooks/useKernel';
import type { Cove, Route, Wave, WaveCardData } from './types';
import type { AddPanelKind } from './ui';

export function CalmApp() {
  const [route, setRoute] = useState<Route>({ name: 'today' });
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const k = useKernel();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  const go = useCallback((r: Route) => setRoute(r), []);

  // ----- Derived UI shapes ------------------------------------------------

  const coves: Cove[] = useMemo(() => k.coves.map(adaptCove), [k.coves]);

  /**
   * UI `Wave[]` built from the flat per-cove fetches. `WavePage` only needs
   * fully-loaded cards when the user navigates into a wave; for the sidebar
   * and TodayPage we just need the kernel wave shape adapted with default
   * status/progress (overlays fold in once `wave_detail` is fetched).
   */
  const waves: Wave[] = useMemo(() => {
    const out: Wave[] = [];
    for (const list of k.wavesByCove.values()) {
      for (const w of list) {
        // If we have detail loaded, use its overlays. Otherwise defaults.
        const detail = k.waveDetails.get(w.id);
        out.push(adaptWave(w, detail?.overlays ?? []));
      }
    }
    return out;
  }, [k.wavesByCove, k.waveDetails]);

  // For the currently-routed wave, fetch detail on demand and produce the
  // UI shape (with cards from detail).
  const currentWave: Wave | null = useMemo(() => {
    if (route.name !== 'wave') return null;
    const detail = k.waveDetails.get(route.id);
    if (!detail) return null;
    const uiWave = adaptWave(detail.wave, detail.overlays);
    uiWave.cards = detail.cards
      .map(adaptCard)
      .filter((c): c is WaveCardData => c !== null);
    return uiWave;
  }, [route, k.waveDetails]);

  // Trigger wave_detail fetch when route lands on an unloaded wave.
  useEffect(() => {
    if (route.name === 'wave' && !k.waveDetails.has(route.id)) {
      void k.refetchWaveDetail(route.id);
    }
  }, [route, k]);

  // ----- Actions ----------------------------------------------------------

  const addCard = useCallback(
    async (waveId: string, type: AddPanelKind) => {
      if (type === 'terminal') {
        try {
          await k.createTerminalCard(waveId);
        } catch (err) {
          console.warn('[Calm] terminal create failed:', err);
        }
        return;
      }
      // doc / plan cards land in M3 with the plugin host. For now noop.
      console.warn(`[Calm] card kind '${type}' not yet wired to the kernel`);
    },
    [k],
  );

  const removeCard = useCallback(
    async (_waveId: string, idx: number) => {
      if (route.name !== 'wave') return;
      const detail = k.waveDetails.get(route.id);
      if (!detail) return;
      const targetCardKernel = detail.cards[idx];
      if (!targetCardKernel) return;
      try {
        await k.deleteCard(targetCardKernel.id);
      } catch (err) {
        console.warn('[Calm] card delete failed:', err);
      }
    },
    [k, route],
  );

  const moveCardTo = useCallback(
    async (_waveId: string, from: number, to: number) => {
      if (from === to) return;
      if (route.name !== 'wave') return;
      const detail = k.waveDetails.get(route.id);
      if (!detail) return;
      // Compute new sort: midpoint between neighbors after the move.
      const cards = detail.cards;
      const moving = cards[from];
      if (!moving) return;
      // Build the slot list as if the move had happened, but with original
      // sort values; pick the target's neighbors there.
      const reordered = cards.slice();
      const [m] = reordered.splice(from, 1);
      reordered.splice(to, 0, m);
      const before = reordered[to - 1];
      const after = reordered[to + 1];
      let newSort: number;
      if (!before && after) newSort = after.sort - 1;
      else if (before && !after) newSort = before.sort + 1;
      else if (before && after) newSort = (before.sort + after.sort) / 2;
      else newSort = 1;
      try {
        await k.setCardSort(moving.id, newSort);
      } catch (err) {
        console.warn('[Calm] card reorder failed:', err);
      }
    },
    [k, route],
  );

  // ----- Render -----------------------------------------------------------

  const findCove = (id: string) => coves.find((c) => c.id === id) || null;

  const renderPage = () => {
    if (k.loading) {
      return <LoadingShell />;
    }
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
      // Use the detail-derived wave if present; otherwise fall back to the
      // flat row from wavesByCove. The fallback won't have cards but the
      // wave-detail fetch is in flight from the effect above.
      const wave = currentWave ?? waves.find((w) => w.id === route.id) ?? null;
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
        <Sidebar
          coves={coves}
          waves={waves}
          route={route}
          onGo={go}
          onCreateCove={async (name, color) => {
            await k.createCove(name, color);
          }}
          onCreateWave={async (coveId, title) => {
            const w = await k.createWave(coveId, title);
            go({ name: 'wave', id: w.id });
          }}
        />
        <main className="page">
          <div className="scroll">
            {k.error && <ErrorBanner err={k.error} />}
            {renderPage()}
          </div>
        </main>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="col">
      <p className="synth">Connecting to calm-server…</p>
    </div>
  );
}

function ErrorBanner({ err }: { err: Error }) {
  return (
    <div className="col" style={{ color: 'var(--warn, #c00)', marginBottom: 12 }}>
      <p className="synth">
        Kernel error: {err.message}. The page reflects the last successful read.
      </p>
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
