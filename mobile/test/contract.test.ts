/**
 * Contract: the TypeScript engine must answer every request exactly like the Python API did on the
 * sample data. `make mobile-golden` records the Python answers (mobile/contract/golden.json).
 */
import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Api } from '../src/engine/api'
import { loadPack } from '../src/engine/pack'
import { diff, normalise } from './support/compare'
import { nodeDb } from './support/node-db'

interface Case {
  method: string
  url: string
  status: number
  body: unknown
}

// CONTRACT_DIR=contract/real replays goldens recorded from your own database (make mobile-golden-real)
const dir = new URL(`../${process.env.CONTRACT_DIR ?? 'contract'}/`, import.meta.url)
const ready = existsSync(new URL('golden.json', dir)) && existsSync(new URL('sample.cx5pack', dir))
const cases: Case[] = ready ? JSON.parse(readFileSync(new URL('golden.json', dir), 'utf8')) : []

describe.skipIf(!ready)('API contract (golden responses of the Python API)', () => {
  const api = new Api({ now: () => new Date('2026-07-01T12:00:00Z') })

  beforeAll(async () => {
    const raw = await nodeDb()
    await loadPack(raw, new Uint8Array(readFileSync(new URL('sample.cx5pack', dir))))
    api.use(raw)
  }, 120_000)

  it('has golden responses', () => expect(cases.length).toBeGreaterThan(300))

  // order matters: the acknowledge requests at the end change state, exactly as they did in Python
  for (const c of cases) {
    it(`${c.method} ${c.url} -> ${c.status}`, async () => {
      const got = await api.handle(c.method, c.url)
      expect(got.status).toBe(c.status)
      const d = diff(c.body, normalise(JSON.parse(JSON.stringify(got.body))))
      expect(d, d ?? '').toBeNull()
    })
  }
})
