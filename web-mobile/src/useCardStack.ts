import { useCallback, useEffect, useState } from 'react'

const LS_KEY = 'neige.mobile.stack.v1'

interface Persisted {
  cards: string[]
  activeIndex: number
}

export type StackView = 'card' | 'overview'

interface Snapshot {
  cards: string[]
  activeIndex: number
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { cards: [], activeIndex: -1 }
    const p = JSON.parse(raw) as Persisted
    if (!Array.isArray(p.cards)) return { cards: [], activeIndex: -1 }
    const idx = Number.isInteger(p.activeIndex) ? p.activeIndex : -1
    return { cards: p.cards.filter((s) => typeof s === 'string'), activeIndex: idx }
  } catch {
    return { cards: [], activeIndex: -1 }
  }
}

function save(s: Snapshot) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s))
  } catch {
    // storage full / denied — not fatal
  }
}

export function useCardStack() {
  const [cards, setCards] = useState<string[]>(() => load().cards)
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const { cards: c, activeIndex: i } = load()
    return i >= 0 && i < c.length ? i : -1
  })
  // Start in overview when there are no cards; otherwise resume with the
  // previously active card so the user lands where they left off.
  const [view, setView] = useState<StackView>(() =>
    load().cards.length === 0 ? 'overview' : 'card',
  )

  useEffect(() => {
    save({ cards, activeIndex })
  }, [cards, activeIndex])

  const add = useCallback((id: string) => {
    setCards((prev) => {
      const existing = prev.indexOf(id)
      if (existing >= 0) {
        setActiveIndex(existing)
        setView('card')
        return prev
      }
      const next = [...prev, id]
      setActiveIndex(next.length - 1)
      setView('card')
      return next
    })
  }, [])

  const addMany = useCallback((ids: string[]) => {
    setCards((prev) => {
      const existing = new Set(prev)
      const fresh = ids.filter((id) => !existing.has(id))
      if (fresh.length === 0) return prev
      const next = [...prev, ...fresh]
      setActiveIndex(next.length - 1)
      setView('card')
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setCards((prev) => {
      const idx = prev.indexOf(id)
      if (idx < 0) return prev
      const next = prev.filter((_, i) => i !== idx)
      setActiveIndex((curr) => {
        if (next.length === 0) return -1
        if (idx < curr) return curr - 1
        if (idx === curr) return Math.min(curr, next.length - 1)
        return curr
      })
      return next
    })
  }, [])

  const activate = useCallback((id: string) => {
    setCards((prev) => {
      const idx = prev.indexOf(id)
      if (idx < 0) return prev
      setActiveIndex(idx)
      setView('card')
      return prev
    })
  }, [])

  const showOverview = useCallback(() => setView('overview'), [])
  const showActive = useCallback(() => {
    if (activeIndex >= 0) setView('card')
  }, [activeIndex])

  const cycle = useCallback(
    (delta: number) => {
      if (cards.length === 0) return
      setActiveIndex((i) => {
        const base = i < 0 ? 0 : i
        return (base + delta + cards.length) % cards.length
      })
      setView('card')
    },
    [cards.length],
  )

  return {
    cards,
    activeIndex,
    activeId: activeIndex >= 0 ? cards[activeIndex] : null,
    view,
    add,
    addMany,
    remove,
    activate,
    showOverview,
    showActive,
    cycle,
  }
}
