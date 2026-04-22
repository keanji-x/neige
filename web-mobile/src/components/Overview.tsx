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
    <div className="overview">
      <header className="list-header">
        <div>
          <div className="list-title">neige</div>
          <div className="list-subtitle">
            {connected ? `${items.length} cards in stack` : 'reconnecting…'}
          </div>
        </div>
        <button className="link-btn" onClick={onLogout}>
          logout
        </button>
      </header>

      <main className="overview-main">
        {items.length === 0 && (
          <div className="empty">
            <p>栈是空的</p>
            <p className="empty-hint">点下面 + 从已有会话里挑一个加进来</p>
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
          <div className="orphan-note">
            {orphans} card(s) 已从 server 消失，已保留占位
          </div>
        )}
      </main>

      <button className="fab" onClick={onAdd} aria-label="add card">
        +
      </button>
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
    <div className={`card${hasUnread ? ' card-unread' : ''}`}>
      <button
        className="card-body"
        onClick={() => {
          if (!longPress.didFire()) onActivate()
        }}
        onTouchStart={longPress.onTouchStart}
        onTouchMove={longPress.onTouchMove}
        onTouchEnd={longPress.onTouchEnd}
        onTouchCancel={longPress.onTouchCancel}
        onContextMenu={longPress.onContextMenu}
      >
        <div className="card-head">
          <span className={`status-dot status-${conv.status}`} />
          <span className="card-title">{conv.title}</span>
          {activity.busy && <span className="card-busy" title="working…" />}
        </div>
        <div className="card-meta">{shortCwd(conv.effective_cwd)}</div>
      </button>
      {hasUnread && (
        <span className="card-badge" aria-label={`${activity.completedBursts} unread`}>
          {activity.completedBursts > 99 ? '99+' : activity.completedBursts}
        </span>
      )}
      <button
        className="card-close"
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
