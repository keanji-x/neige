import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/m/',
  resolve: {
    alias: {
      '@neige/shared': path.resolve(__dirname, '../packages/neige-web-shared/src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3030',
      '/ws': {
        target: 'ws://localhost:3030',
        ws: true,
      },
    },
  },
})
