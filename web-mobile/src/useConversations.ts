import { useConversationsPoll } from '@neige/shared'

export function useConversations() {
  return useConversationsPoll({ intervalMs: 5000 })
}
