import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Forward /api/* to the Express server so the browser never hits CORS.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:5000' } },
})