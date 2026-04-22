import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/m/',
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
