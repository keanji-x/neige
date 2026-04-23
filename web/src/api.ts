import { configureApi } from '@neige/shared';

/**
 * Wire shared api 401 handling to a hard redirect. Desktop has no in-app
 * login flow, so on expired session we bounce to the server-side /login page.
 */
configureApi({
  onUnauthorized: () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  },
});

export * from '@neige/shared';
