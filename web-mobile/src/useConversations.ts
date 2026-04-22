import { useCallback, useEffect, useState } from 'react'
import { listConversations } from './api'
import type { ConvInfo } from './types'

export function useConversations() {
  const [conversations, setConversations] = useState<ConvInfo[]>([])
  const [connected, setConnected] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const list = await listConversations()
      setConversations(list)
      setConnected(true)
    } catch {
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let failCount = 0

    const poll = async () => {
      try {
        const list = await listConversations()
        if (cancelled) return
        setConversations(list)
        setConnected(true)
        failCount = 0
      } catch {
        if (cancelled) return
        setConnected(false)
        failCount++
      }
      if (!cancelled) {
        const delay = failCount > 0 ? Math.min(3000 * Math.pow(1.5, failCount), 30000) : 5000
        timer = setTimeout(poll, delay)
      }
    }

    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return { conversations, connected, refresh }
}
