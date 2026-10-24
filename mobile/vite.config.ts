import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const frontend = fileURLToPath(new URL('../frontend/src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  // './' keeps the built app working from any address (GitHub Pages sub-path, a local file server)
  base: './',
  resolve: {
    alias: { '@frontend': frontend },
    // the pages live in ../frontend/src: use ONE copy of these packages, this folder's
    dedupe: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'recharts', 'openapi-fetch', 'react-is'],
  },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  // the pages (../frontend/src) and views.sql (../backend) are shared with the Mac app
  server: { fs: { allow: ['..'] } },
})
