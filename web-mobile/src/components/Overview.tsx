import clsx from 'clsx'
import { Button } from '@neige/shared'
import type { ConvInfo } from '../types'
import { useCardActivity } from '../cardActivity'
import { useLongPress } from '../useLongPress'

interface Props {
  cards: string[]
  conversations: ConvInfo[]
  connected: boolean
  onActivate: (id: string) => void
  onRemove: (id: string) => void
  onLongPress: (id: string) => void
  onAdd: () => void
  onLogout: () => void
}

function shortCwd(cwd: string): string {
  const home = '/home/'
  if (cwd.startsWith(home)) {
    const rest = cwd.slice(home.length)
    const slash = rest.indexOf('/')
    return slash === -1 ? `~${rest}` : `~${rest.slice(slash)}`
  }
  return cwd
}

export function Overview({
  cards,
  conversations,
  connected,
  onActivate,
  onRemove,
  onLongPress,
  onAdd,
  onLogout,
}: Props) {
  const byId = new Map(conversations.map((c) => [c.id, c]))
  const items = cards.map((id) => byId.get(id)).filter((c): c is ConvInfo => !!c)

  const orphans = cards.length - items.length

  return (
    <div className="absolute inset-0 z-[2] bg-bg-primary flex flex-col">
      <header className="flex items-center justify-between py-4 px-[18px] border-b border-border bg-bg-secondary">
        <div>
          <div className="text-[18px] font-semibold">neige</div>
          <div className="text-[12px] text-text-muted mt-0.5">
            {connected ? `${items.length} cards in stack` : 'reconnecting…'}
          </div>
        </div>
        <button
          className="text-text-muted text-sm px-2.5 py-1.5 active:text-text-primary"
          onClick={onLogout}
        >
          logout
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
        {items.length === 0 && (
          <div className="py-12 px-6 text-center text-text-muted">
            <p>栈是空的</p>
            <p className="text-sm mt-1">点下面 + 从已有会话里挑一个加进来</p>
          </div>
        )}

        {items.map((c) => (
          <OverviewCard
            key={c.id}
            conv={c}
            onActivate={() => onActivate(c.id)}
            onRemove={() => onRemove(c.id)}
            onLongPress={() => onLongPress(c.id)}
          />
        ))}

        {orphans > 0 && (
          <div className="py-2.5 px-3 text-text-muted text-[12px] text-center border border-dashed border-border rounded-[8px]">
            {orphans} card(s) 已从 server 消失，已保留占位
          </div>
        )}
      </main>

      <Button
        variant="primary"
        size="icon"
        className="rounded-full h-14 w-14 fixed bottom-6 right-6 shadow-lg text-2xl"
        onClick={onAdd}
        aria-label="add card"
      >
        +
      </Button>
    </div>
  )
}

function OverviewCard({
  conv,
  onActivate,
  onRemove,
  onLongPress,
}: {
  conv: ConvInfo
  onActivate: () => void
  onRemove: () => void
  onLongPress: () => void
}) {
  const activity = useCardActivity(conv.id)
  const hasUnread = activity.completedBursts > 0
  const longPress = useLongPress(onLongPress, 450)

  return (
    <div
      className={clsx(
        'relative bg-bg-secondary border border-border rounded-[12px] overflow-hidden flex active:bg-bg-hover',
        hasUnread && 'border-green-dim',
      )}
    >
      <button
        className="flex-1 flex flex-col gap-1 py-[14px] pl-4 pr-[14px] text-left min-w-0"
        onClick={() => {
          if (!longPress.didFire()) onActivate()
        }}
        onTouchStart={longPress.onTouchStart}
        onTouchMove={longPress.onTouchMove}
        onTouchEnd={longPress.onTouchEnd}
        onTouchCancel={longPress.onTouchCancel}
        onContextMenu={longPress.onContextMenu}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={clsx(
              'inline-block w-2 h-2 rounded-full shrink-0',
              conv.status === 'running' &&
                'bg-status-running shadow-[0_0_6px_rgba(63,185,80,0.45)]',
              conv.status === 'detached' && 'bg-yellow',
              conv.status === 'dead' && 'bg-red',
              conv.status !== 'running' &&
                conv.status !== 'detached' &&
                conv.status !== 'dead' &&
                'bg-text-muted',
            )}
          />
          <span className="text-[15px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
            {conv.title}
          </span>
          {activity.busy && (
            <span
              className="w-2 h-2 rounded-full bg-status-running ml-0.5 animate-[pulse-green_1.4s_ease-in-out_infinite]"
              title="working…"
            />
          )}
        </div>
        <div className="text-[12px] text-text-muted font-mono whitespace-nowrap overflow-hidden text-ellipsis">
          {shortCwd(conv.effective_cwd)}
        </div>
      </button>
      {hasUnread && (
        <span
          className="shrink-0 min-w-[22px] h-[22px] px-[7px] self-center mr-1 bg-red text-white rounded-[11px] text-[12px] font-semibold grid place-items-center leading-none"
          aria-label={`${activity.completedBursts} unread`}
        >
          {activity.completedBursts > 99 ? '99+' : activity.completedBursts}
        </span>
      )}
      <button
        className="shrink-0 w-11 text-text-muted text-lg border-l border-border grid place-items-center active:text-red active:bg-[rgba(248,81,73,0.08)]"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label="remove from stack"
      >
        ✕
      </button>
    </div>
  )
}
