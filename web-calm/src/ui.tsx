import { Fragment, useState } from 'react';
import { Icon } from './Icon';
import { XtermView } from './XtermView';
import type {
  Cove,
  DiffCardData,
  DocCardData,
  GitCardData,
  PlanCardData,
  Route,
  TerminalCardData,
  Wave,
  WaveCardData,
  WaveStatus,
} from './types';

export function coveOf(coveId: string, coves: Cove[]): Cove | undefined {
  return coves.find((c) => c.id === coveId);
}

export function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 5)  return 'Late night';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
}

// ---------------- TitleBar ----------------

export function TitleBar({
  theme,
  onToggleTheme,
}: {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  return (
    <div className="bar">
      <div className="lights">
        <span className="a" />
        <span className="b" />
        <span className="c" />
      </div>
      <div className="name">Neige</div>
      <div className="right">
        <button className="go ghost" onClick={onToggleTheme} title="Toggle theme">
          <Icon n={theme === 'dark' ? 'sun' : 'moon'} s={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------- Crumbs ----------------

interface CrumbItem {
  label: string;
  onClick?: () => void;
}

export function Crumbs({ items }: { items: CrumbItem[] }) {
  return (
    <div className="crumbs">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {last ? (
              <span className="now">{it.label}</span>
            ) : (
              <a onClick={it.onClick}>{it.label}</a>
            )}
            {!last && <span>·</span>}
          </Fragment>
        );
      })}
    </div>
  );
}

// ---------------- ProgressBar ----------------

export function ProgressBar({
  value,
  status,
}: {
  value: number;
  status?: WaveStatus;
}) {
  return (
    <div className={'fill ' + (status === 'running' ? 'running' : '')}>
      <div className="v" style={{ width: value * 100 + '%' }} />
    </div>
  );
}

// ---------------- WaveGlyph ----------------

export function WaveGlyph({ status }: { status: WaveStatus }) {
  return (
    <span className="glyph">
      {status === 'running' ? (
        <span
          className="live-dot"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--accent)',
            display: 'block',
          }}
        />
      ) : (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--warn)',
            display: 'block',
            boxShadow: '0 0 0 4px var(--warn-soft)',
          }}
        />
      )}
    </span>
  );
}

// ---------------- WaveRow ----------------

export function WaveRow({
  wave,
  cove,
  showCove = true,
  onClick,
}: {
  wave: Wave;
  cove?: Cove;
  showCove?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className="wave-row" onClick={onClick}>
      <WaveGlyph status={wave.status} />
      <div className="body">
        <div className="t">{wave.title}</div>
        <div className="s">
          {showCove && cove && (
            <>
              <span className="cove-tag">
                <i style={{ background: cove.color }} />
                {cove.name}
              </span>
              <span>·</span>
            </>
          )}
          <span>{wave.now}</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          minWidth: 110,
        }}
      >
        {wave.status === 'running' && (
          <ProgressBar value={wave.progress} status="running" />
        )}
        <span className="when">{wave.eta}</span>
      </div>
    </button>
  );
}

// ============================================================
// WaveCard — dispatches on card type.
// ============================================================

function TerminalCard({ title, lines, terminalId }: TerminalCardData) {
  const live = !!terminalId;
  return (
    <div className={'term' + (live ? ' live' : '')}>
      <div className="term-head">
        <span className="term-dot" />
        <span className="term-dot b" />
        <span className="term-dot c" />
        <span className="term-title">
          {title || 'terminal'}
          {live && <span className="term-live-pip"> · live</span>}
        </span>
      </div>
      <div className="term-body">
        {live ? (
          <XtermView terminalId={terminalId!} />
        ) : (
          <>
            {lines.map((l, i) => (
              <div key={i} className={'term-line k-' + l.kind}>
                {l.text}
              </div>
            ))}
            <div className="term-line k-cursor">
              <span className="term-cursor" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function inlineFmt(html: string): string {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function DocCard({ card }: { card: DocCardData }) {
  return (
    <div className="doc">
      <div className="doc-head">{card.title}</div>
      <div className="doc-body">
        {card.body.split('\n\n').map((para, i) => (
          <p key={i} dangerouslySetInnerHTML={{ __html: inlineFmt(para) }} />
        ))}
      </div>
    </div>
  );
}

function GitCard({ card }: { card: GitCardData }) {
  return (
    <div className="git">
      <div className="git-head">
        <span className="git-branch">{card.branch}</span>
        <span className="git-count">
          {card.commits.length} commit{card.commits.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="git-body">
        {card.commits.map((c, i) => (
          <div key={i} className="git-row">
            <span className="git-sha">{c.sha}</span>
            <span className="git-msg">{c.msg}</span>
            <span className="git-when">{c.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffCard({ card }: { card: DiffCardData }) {
  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-file">{card.file}</span>
        <span className="diff-stats">
          <span className="diff-add">+{card.added}</span>
          <span className="diff-rm">−{card.removed}</span>
        </span>
      </div>
      <div className="diff-body">
        {card.hunks.map((h, i) => (
          <div key={i} className="diff-hunk">
            <div className="diff-line k-hdr">{h.header}</div>
            {h.lines.map((l, j) => (
              <div key={j} className={'diff-line k-' + l.kind}>
                <span className="diff-gutter">
                  {l.kind === 'add' ? '+' : l.kind === 'rm' ? '−' : ' '}
                </span>
                <span className="diff-text">{l.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanCard({ card }: { card: PlanCardData }) {
  return (
    <div className="plan-card">
      <div className="plan-card-head">Plan</div>
      <ol className="plan-card-body">
        {card.steps.map((s, i) => (
          <li key={i} className={s.done ? 'done' : s.cur ? 'cur' : ''}>
            <span className="dot">{s.done && '✓'}</span>
            <span className="lbl">{s.label}</span>
            {s.when && <span className="when">{s.when}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WaveCard({ card }: { card: WaveCardData | null | undefined }) {
  if (!card) return null;
  if (card.type === 'terminal') return <TerminalCard {...card} />;
  if (card.type === 'doc')      return <DocCard card={card} />;
  if (card.type === 'git')      return <GitCard card={card} />;
  if (card.type === 'diff')     return <DiffCard card={card} />;
  if (card.type === 'plan')     return <PlanCard card={card} />;
  return null;
}

// ---------------- Sidebar ----------------

export function Sidebar({
  coves,
  waves,
  route,
  onGo,
  onCreateCove,
  onCreateWave,
}: {
  coves: Cove[];
  waves: Wave[];
  route: Route;
  onGo: (r: Route) => void;
  /** When supplied, the sidebar renders a `+ New Cove` button below the
   *  Coves list. Used to bootstrap a fresh kernel — once we have a real
   *  plugin layer this moves into a command-palette / settings panel. */
  onCreateCove?: (name: string, color: string) => void | Promise<void>;
  onCreateWave?: (coveId: string, title: string) => void | Promise<void>;
}) {
  const waitingWaves = waves.filter((w) => w.status === 'waiting');
  return (
    <aside className="side">
      <button
        className={'nav-item nav-today' + (route.name === 'today' ? ' active' : '')}
        onClick={() => onGo({ name: 'today' })}
      >
        <span className="lbl">Today</span>
      </button>

      {waitingWaves.length > 0 && (
        <>
          <div className="nav-label warn-text">Waiting on you</div>
          {waitingWaves.map((w) => {
            const cove = coves.find((c) => c.id === w.coveId);
            const active = route.name === 'wave' && route.id === w.id;
            return (
              <button
                key={w.id}
                className={'side-wave' + (active ? ' active' : '')}
                onClick={() => onGo({ name: 'wave', id: w.id })}
                title={(cove?.name ?? '') + ' · ' + w.title}
              >
                <span className="side-wave-dot" />
                <span className="side-wave-title">{w.title}</span>
              </button>
            );
          })}
        </>
      )}

      <div className="nav-label">Coves</div>
      {coves.map((cove) => {
        const cw = waves.filter((w) => w.coveId === cove.id);
        const running = cw.filter((w) => w.status === 'running').length;
        const waiting = cw.filter((w) => w.status === 'waiting').length;
        const active = route.name === 'cove' && route.coveId === cove.id;
        return (
          <button
            key={cove.id}
            className={'cove-nav' + (active ? ' active' : '')}
            onClick={() => onGo({ name: 'cove', coveId: cove.id })}
          >
            <span className="swatch-wrap">
              <span
                className={'swatch' + (running > 0 ? ' pulse' : '')}
                style={{ background: cove.color }}
              />
              {waiting > 0 && <span className="pip">{waiting}</span>}
            </span>
            <span className="lbl">{cove.name}</span>
          </button>
        );
      })}
      {onCreateCove && <NewCoveButton onCreate={onCreateCove} />}
      {onCreateWave && route.name === 'cove' && (
        <NewWaveButton coveId={route.coveId} onCreate={onCreateWave} />
      )}

      <span className="sp" />
      <div className="me-row">
        <span className="me">YK</span>
        <span className="who">
          Yuki K.
          <div className="sub">Pro · 5 agents online</div>
        </span>
      </div>
    </aside>
  );
}

// ---------------- NewCove / NewWave inline forms ----------------

const SWATCH_COLORS = ['#5a9', '#c97', '#79c', '#b86', '#6a8', '#a6c'];

function NewCoveButton({
  onCreate,
}: {
  onCreate: (name: string, color: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCH_COLORS[0]);
  if (!open) {
    return (
      <button className="cove-nav new" onClick={() => setOpen(true)} title="New cove">
        <span className="swatch-wrap"><span className="swatch ghost">+</span></span>
        <span className="lbl">New cove</span>
      </button>
    );
  }
  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    await onCreate(n, color);
    setName('');
    setOpen(false);
  };
  return (
    <div className="cove-nav new editing">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
        <select
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ background: color, width: 24, height: 24, borderRadius: 6, border: 'none' }}
          aria-label="cove color"
        >
          {SWATCH_COLORS.map((c) => (
            <option key={c} value={c} style={{ background: c }}>{c}</option>
          ))}
        </select>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Cove name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') setOpen(false);
          }}
          style={{ flex: 1, minWidth: 0, font: 'inherit' }}
        />
      </div>
    </div>
  );
}

function NewWaveButton({
  coveId,
  onCreate,
}: {
  coveId: string;
  onCreate: (coveId: string, title: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  if (!open) {
    return (
      <button className="cove-nav new" onClick={() => setOpen(true)} title="New wave">
        <span className="swatch-wrap"><span className="swatch ghost">+</span></span>
        <span className="lbl">New wave</span>
      </button>
    );
  }
  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    await onCreate(coveId, t);
    setTitle('');
    setOpen(false);
  };
  return (
    <div className="cove-nav new editing">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Wave title"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        style={{ width: '100%', font: 'inherit' }}
      />
    </div>
  );
}

// ---------------- AddPanel ----------------

export type AddPanelKind = 'terminal' | 'doc' | 'plan';

export function AddPanel({
  onAdd,
  hasPlan,
}: {
  onAdd: (type: AddPanelKind) => void;
  hasPlan: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="add-panel" onClick={() => setOpen(true)}>
        + Add panel
      </button>
    );
  }
  const pick = (type: AddPanelKind) => {
    onAdd(type);
    setOpen(false);
  };
  return (
    <div className="add-panel-menu">
      <button onClick={() => pick('terminal')}>New terminal</button>
      <button onClick={() => pick('doc')}>New note</button>
      {!hasPlan && <button onClick={() => pick('plan')}>New plan</button>}
      <button className="cancel" onClick={() => setOpen(false)}>
        cancel
      </button>
    </div>
  );
}
