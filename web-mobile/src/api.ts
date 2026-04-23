import { configureApi } from '@neige/shared'
import { authStore } from './authStore'

/**
 * Route shared 401 handling into the mobile auth store so any expired-session
 * response bounces the user back to the login screen.
 */
configureApi({
  onUnauthorized: () => authStore.setAnonymous(),
})

export * from '@neige/shared'
