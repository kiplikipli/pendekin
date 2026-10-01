import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/r': 'http://localhost:8787',
      '/docs': 'http://localhost:8787',
      '/openapi.json': 'http://localhost:8787',
      '/llms.txt': 'http://localhost:8787',
      '/mcp': 'http://localhost:8787',
    },
  },
})
