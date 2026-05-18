import { Fragment, useRef, useState } from 'react';
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
        // Live pulse — accent color.
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
      ) : status === 'waiting' ? (
        // Needs-you halo — warn color with soft glow. Used only when a
        // plugin explicitly says the wave is blocked on the user.
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
      ) : (
        // Idle — no overlay yet. Small dim dot, no halo. Calm.
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--text-3, oklch(60% 0.005 245))',
            opacity: 0.55,
            display: 'block',
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
  onDelete,
}: {
  wave: Wave;
  cove?: Cove;
  showCove?: boolean;
  onClick?: () => void;
  /** Optional per-row delete. When supplied, a × button reveals on hover
   *  on the right of the row. Caller is responsible for its own confirm
   *  dialog (so the row delete and header delete read identically). */
  onDelete?: () => void;
}) {
  // Avoid the "double-bullet" effect: only emit the `·` separator when both
  // a cove tag AND a `now` line are going to render. Empty `now` (i.e. no
  // plugin posted activity text) drops out cleanly.
  const showCoveTag = showCove && !!cove;
  const showNow = !!wave.now;
  const showEta = !!wave.eta;
  const showProgress = wave.status === 'running' && wave.progress > 0;

  // The row used to be a real <button>, but adding a nested button for the
  // hover-reveal delete is invalid HTML. So the row is a div with the
  // navigation as a click+keydown handler, and the × is a real button
  // child whose click stops propagation so it doesn't also navigate.
  return (
    <div
      className="wave-row"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <WaveGlyph status={wave.status} />
      <div className="body">
        <div className="t">{wave.title}</div>
        {(showCoveTag || showNow) && (
          <div className="s">
            {showCoveTag && (
              <span className="cove-tag">
                <i style={{ background: cove!.color }} />
                {cove!.name}
              </span>
            )}
            {showCoveTag && showNow && <span>·</span>}
            {showNow && <span>{wave.now}</span>}
          </div>
        )}
      </div>
      {(showProgress || showEta) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
            minWidth: 110,
          }}
        >
          {showProgress && (
            <ProgressBar value={wave.progress} status="running" />
          )}
          {showEta && <span className="when">{wave.eta}</span>}
        </div>
      )}
      {onDelete && (
        <button
          className="wave-row-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={`Delete "${wave.title}"`}
          aria-label={`Delete "${wave.title}"`}
        >
          ×
        </button>
      )}
    </div>
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
}: {
  coves: Cove[];
  waves: Wave[];
  route: Route;
  onGo: (r: Route) => void;
  /** Bootstrap affordance: renders a small `+ New Cove` row below the
   *  Coves list. Lives here (not in CovePage) because creating the *first*
   *  cove has no other home. Wave creation, by contrast, lives inside
   *  CovePage where the cove context is already established. */
  onCreateCove?: (name: string, color: string) => void | Promise<void>;
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
            {cw.length > 0 && <span className="count">{cw.length}</span>}
          </button>
        );
      })}
      {onCreateCove && <NewCoveButton onCreate={onCreateCove} />}

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

// ---------------- NewCoveButton ----------------
//
// Lives in the sidebar because creating the *first* cove has no other home;
// every subsequent affordance (new wave, new card) lives inside the page
// it belongs to. Bootstraps a random color from a fixed palette — a real
// color picker can land in a settings/command-palette pass later.

const PALETTE = ['#5a9', '#c97', '#79c', '#b86', '#6a8', '#a6c'];

function NewCoveButton({
  onCreate,
}: {
  onCreate: (name: string, color: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // When the inline form opens, focus the input on the next tick so the
  // ref is bound. Cheaper than a separate effect for one-shot focus.
  const openForm = () => {
    setOpen(true);
    queueMicrotask(() => inputRef.current?.focus());
  };
  const close = () => {
    setOpen(false);
    setName('');
  };
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      close();
      return;
    }
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    await onCreate(trimmed, color);
    close();
  };

  if (!open) {
    return (
      <button className="cove-nav new" onClick={openForm} title="New cove">
        <span className="swatch-wrap">
          <span className="swatch-plus">+</span>
        </span>
        <span className="lbl">New cove</span>
      </button>
    );
  }
  return (
    <div className="cove-nav-edit">
      <span className="swatch-wrap">
        <span className="swatch-plus">+</span>
      </span>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          else if (e.key === 'Escape') close();
        }}
        onBlur={() => void submit()}
        placeholder="Name…"
      />
    </div>
  );
}

// ---------------- AddPanel ----------------

export type AddPanelKind = 'terminal' | 'doc' | 'plan';

export function AddPanel({
  onAdd,
}: {
  onAdd: (type: AddPanelKind) => void;
  /** Carried for API stability; ignored while only `terminal` is wired. */
  hasPlan?: boolean;
}) {
  // While the plugin host is still M3 work, only the built-in `terminal`
  // card is actually wired end-to-end. Showing menu items for `doc` /
  // `plan` would be a promise we can't keep, so the affordance collapses
  // to a single direct-action button. When plugins land we'll restore the
  // multi-option menu (driven by the manifest list rather than hard-coded).
  return (
    <button
      className="add-panel"
      onClick={() => onAdd('terminal')}
      title="New terminal"
    >
      + New terminal
    </button>
  );
}
