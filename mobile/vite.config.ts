import { mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'

/**
 * Dev/preview only: lets the spike page report its measurements back from ANY browser (Chrome,
 * Safari, an iPhone on the same Wi-Fi), so no browser automation is needed. Writes
 * spike-results/<label>-<time>.json (gitignored). The label is sanitised and the body capped.
 */
function resultsSink(): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/__results')) return next()
    if (req.method !== 'POST') {
      res.statusCode = 405
      return res.end()
    }
    const label = (new URL(req.url, 'http://x').searchParams.get('label') ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'unknown'
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 1_000_000) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      mkdirSync('spike-results', { recursive: true })
      writeFileSync(`spike-results/${label}-${Date.now()}.json`, Buffer.concat(chunks))
      res.statusCode = 204
      res.end()
    })
  }
  return {
    name: 'results-sink',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}

export default defineConfig({
  plugins: [resultsSink()],
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  // views.sql is imported from the backend folder: one source of truth for the SQL
  server: { fs: { allow: ['..'] } },
})
