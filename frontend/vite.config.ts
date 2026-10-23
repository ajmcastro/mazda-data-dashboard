import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The API (make api) listens on :8000; proxying keeps the browser on a single origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  test: { environment: 'node' },
})
