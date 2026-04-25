import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@neige/shared': path.resolve(__dirname, '../packages/neige-web-shared/src'),
    },
    // Force a single React identity. The shared package lives in a sibling
    // directory whose node_modules is a symlink to web/node_modules; without
    // dedupe, Vite resolves react via two different paths and bundles two
    // copies, leaving the dispatcher null in components imported through
    // @neige/shared (e.g. ToastProvider's useState crashes).
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3030',
      '/ws': {
        target: 'ws://localhost:3030',
        ws: true,
      },
    },
  },
})
