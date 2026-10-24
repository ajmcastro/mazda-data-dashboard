import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const frontend = fileURLToPath(new URL('../frontend/src', import.meta.url))

/** After the build: writes dist/sw.js from sw.template.js with every built file to precache and a version that changes whenever any of them does. */
function serviceWorker(): Plugin {
  let outDir = 'dist'
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : [path]
    })
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved: (config) => void (outDir = config.build.outDir),
    closeBundle() {
      const files = walk(outDir)
        .map((f) => relative(outDir, f))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.reference.json'))
        .sort()
      const hash = createHash('sha256')
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)))
      const template = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8')
      writeFileSync(
        join(outDir, 'sw.js'),
        template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('__PRECACHE__', JSON.stringify(['./', ...files], null, 1)),
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
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
