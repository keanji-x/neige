import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Calm runs as its own Vite app — sibling to web/ and web-mobile/. In dev it
// owns port 5175 (web=5173, web-mobile=5174). In prod it serves under /calm/
// so neige-server can mount it next to the existing UIs without overlap.
export default defineConfig({
  plugins: [react()],
  base: '/calm/',
  resolve: {
    alias: {
      '@neige/shared': path.resolve(__dirname, '../packages/neige-web-shared/src'),
    },
    // Force a single React identity. Shared lives in a sibling directory
    // whose node_modules is a symlink to web-calm/node_modules; without
    // dedupe, Vite would resolve react via two paths and bundle two copies.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    proxy: {
      // calm-server (new kernel) on :4040 owns /api and its WS endpoints
      // (/api/events, /api/terminals/:id). The old neige-server stays put
      // on :3030/:3232; the swap is purely client-side.
      '/api': { target: 'http://localhost:4040', changeOrigin: true, ws: true },
    },
  },
})
