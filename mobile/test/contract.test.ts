/**
 * Contract: the TypeScript engine must answer every request exactly like the Python API did on the
 * sample data. `make mobile-golden` records the Python answers (mobile/contract/golden.json).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Api } from '../src/engine/api'
import { loadPack, type Manifest } from '../src/engine/pack'
import { diff, normalise } from './support/compare'
import { nodeDb } from './support/node-db'

interface Case {
  method: string
  url: string
  status: number
  body: unknown
}

// make mobile-golden records one folder per car model (contract/<model>/); CONTRACT_DIR=contract/real replays
// goldens recorded from your own database (make mobile-golden-real), a folder that holds them directly
const root = new URL(`../${process.env.CONTRACT_DIR ?? 'contract'}/`, import.meta.url)
const isGolden = (dir: URL) => existsSync(new URL('golden.json', dir)) && existsSync(new URL('sample.cx5pack', dir))
const dirs: { model: string; dir: URL }[] = isGolden(root)
  ? [{ model: 'real', dir: root }]
  : existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && isGolden(new URL(`${d.name}/`, root)))
        .map((d) => ({ model: d.name, dir: new URL(`${d.name}/`, root) }))
    : []

describe.skipIf(dirs.length === 0)('goldens exist for every model', () => {
  it('has goldens for the CX-5 and the CX-60 sample models', () => {
    if (process.env.CONTRACT_DIR) return // your own database: one model
    expect(dirs.map((d) => d.model)).toEqual(expect.arrayContaining(['cx5', 'cx60']))
  })
})

for (const { model, dir } of dirs) {
  const cases: Case[] = JSON.parse(readFileSync(new URL('golden.json', dir), 'utf8'))

  describe(`API contract, ${model} (golden responses of the Python API)`, () => {
    const api = new Api({ now: () => new Date('2026-07-01T12:00:00Z') })
    let manifest: Manifest

    beforeAll(async () => {
      const raw = await nodeDb()
      manifest = await loadPack(raw, new Uint8Array(readFileSync(new URL('sample.cx5pack', dir))))
      api.use(raw, manifest.model.id)
    }, 120_000)

    it('has golden responses', () => expect(cases.length).toBeGreaterThan(300))

    it('the pack names its model', () => expect(manifest.model.id.length).toBeGreaterThan(0))

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
}
