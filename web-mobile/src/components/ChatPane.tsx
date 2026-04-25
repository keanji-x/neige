import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Flex, Text } from '@radix-ui/themes'
import { MessageBubble, useChatSession } from '@neige/shared'
import type { ConvInfo } from '../types'
import { ComposeBar } from './ComposeBar'
import { cardActivity } from '../cardActivity'

interface Props {
  conv: ConvInfo
  active: boolean
  onOverview: () => void
  onPrev: () => void
  onNext: () => void
  canCycle: boolean
}

const STICK_THRESHOLD_PX = 120

/**
 * Chat-mode (Mode B) pane: WS-driven NeigeEvent stream rendered with the
 * shared MessageBubble components plus the mobile ComposeBar. We don't use
 * the shared `ChatView` directly because it bakes in its own desktop-style
 * ComposeBox; mobile needs the floating-above-keyboard compose pattern.
 *
 * Stays mounted with its WS open so card-switches feel instant, mirroring
 * TerminalPane.
 */
export function ChatPane({ conv, active, onOverview, onPrev, onNext, canCycle }: Props) {
  const { events, timeline, toolResults, status, sendMessage } = useChatSession({
    sessionId: conv.id,
  })

  // Auto-scroll-to-bottom unless the user has explicitly scrolled away.
  const scrollRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)

  // iOS keyboard avoidance: shrink the pane's effective height to match
  // visualViewport when the soft keyboard is open, so the compose bar stays
  // above it. The terminal pane gets this for free via xterm's fit; here we
  // drive it with a CSS variable.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => {
      const el = paneRef.current
      if (!el) return
      // The gap between innerHeight and visualViewport height is ~the
      // keyboard. Shave that off the bottom of the pane.
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      el.style.setProperty('--kbd-inset', `${inset}px`)
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      setStickToBottom(dist < STICK_THRESHOLD_PX)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    if (!stickToBottom) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [events, stickToBottom])

  // Mirror "assistant mid-stream" into per-card activity. While the most-recent
  // assistant message hasn't completed, ping the activity store so the card
  // pulses in Overview just like terminal cards do.
  // TODO(activity): plug into the burst-completion model so the unread badge
  // counts finished assistant messages instead of approximating from output.
  useEffect(() => {
    const assistant = [...timeline.messages].reverse().find((m) => m.role === 'assistant')
    if (assistant && assistant.role === 'assistant' && !assistant.isComplete) {
      cardActivity.onOutput(conv.id)
    }
  }, [conv.id, timeline.messages])

  const statusColor =
    status === 'open' ? 'var(--green-9)' :
    status === 'connecting' || status === 'reconnecting' ? 'var(--yellow-9)' :
    'var(--red-9)'

  const empty = timeline.messages.length === 0
  const closed = status === 'closed'

  return (
    <div className="term-pane chat-pane" data-active={active} ref={paneRef}>
      <header className="term-header">
        <button className="icon-btn" onClick={onOverview} aria-label="overview">
          ⊟
        </button>
        <div className="term-title-wrap">
          <div className="term-title">{conv.title}</div>
          <div className="term-status">
            <span
              className="status-dot"
              style={{ background: statusColor }}
              title={status}
            />
            <span>chat · {status}</span>
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={onPrev}
          disabled={!canCycle}
          aria-label="previous"
        >
          ‹
        </button>
        <button
          className="icon-btn"
          onClick={onNext}
          disabled={!canCycle}
          aria-label="next"
        >
          ›
        </button>
      </header>

      <Box ref={scrollRef} className="chat-body">
        {timeline.init && (
          <Box px="3" py="2" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
            <Flex gap="2" align="center" wrap="wrap">
              <Text size="1" weight="medium" color="gray">{timeline.init.model}</Text>
              <Text
                size="1"
                color="gray"
                style={{ fontFamily: 'var(--code-font-family)' }}
              >
                {timeline.init.cwd}
              </Text>
              {timeline.status && (
                <Text size="1" color="gray">· {timeline.status}</Text>
              )}
            </Flex>
          </Box>
        )}

        {closed && (
          <Box px="3" py="2" style={{ background: 'rgba(248, 81, 73, 0.08)' }}>
            <Text size="2" style={{ color: 'var(--red)' }}>
              Session closed
            </Text>
          </Box>
        )}

        {empty ? (
          <Flex direction="column" align="center" justify="center" gap="1" py="9">
            <Text size="3" color="gray">Type to start the conversation</Text>
            <Text size="1" color="gray">
              {status === 'open' ? 'connected' : status}
            </Text>
          </Flex>
        ) : (
          <Box px="3" py="3">
            {timeline.messages.map((m) => (
              <MessageBubble key={m.id} message={m} toolResults={toolResults} respond={sendMessage} />
            ))}
            {timeline.result && (
              <Flex justify="center" py="2">
                <Text size="1" color="gray">
                  {timeline.result.terminalReason} · {timeline.result.durationMs}ms
                  {timeline.result.totalCostUsd > 0 &&
                    ` · $${timeline.result.totalCostUsd.toFixed(4)}`}
                </Text>
              </Flex>
            )}
          </Box>
        )}

        {(status === 'connecting' || status === 'reconnecting') && (
          <Box
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(0,0,0,0.5)',
            }}
          >
            <Text size="1" color="gray">{status}…</Text>
          </Box>
        )}
      </Box>

      <ComposeBar
        busy={false}
        variant="chat"
        placeholder="message Claude…"
        onSend={(text) => sendMessage(text)}
      />
    </div>
  )
}
