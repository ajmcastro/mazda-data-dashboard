import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Api, createFetch } from '../src/engine/api'
import { MemoryAckStore, replayAcks } from '../src/engine/alerts'
import { bind, Con, Ts } from '../src/engine/db'
import { loadPack, PackError, readPack } from '../src/engine/pack'
import { pyRound } from '../src/engine/pyround'
import { nodeDb } from './support/node-db'

const packFile = new URL('../contract/sample.cx5pack', import.meta.url)
const packBytes = () => new Uint8Array(readFileSync(packFile))
const clock = () => new Date('2026-07-01T12:34:56.789000Z')

async function fresh(store = new MemoryAckStore()) {
  const raw = await nodeDb()
  await loadPack(raw, packBytes())
  await replayAcks(new Con(raw), store)
  const api = new Api({ acks: store, now: clock })
  api.use(raw)
  return { raw, api, store }
}

describe('acknowledgements are kept on the phone', () => {
  let api: Api
  let store: MemoryAckStore
  beforeAll(async () => ({ api, store } = await fresh()), 120_000)

  it('acknowledging one alert changes it and the new-alert count', async () => {
    const before = (await api.handle('GET', '/api/alerts?status=new')).body as { alert_id: number }[]
    expect(before.length).toBeGreaterThan(2)
    const res = await api.handle('POST', `/api/alerts/${before[0].alert_id}/acknowledge`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'acknowledged', acknowledged_at: '2026-07-01T12:34:56.789000Z' })
    const overview = (await api.handle('GET', '/api/overview')).body as { alerts_new: number }
    expect(overview.alerts_new).toBe(before.length - 1)
    expect(Object.keys(await store.load())).toHaveLength(1)
  })

  it('survives a restart: a fresh engine on the same pack replays them', async () => {
    const again = await fresh(store)
    const acked = (await again.api.handle('GET', '/api/alerts?status=acknowledged')).body as { acknowledged_at: string }[]
    expect(acked).toHaveLength(1)
    expect(acked[0].acknowledged_at).toBe('2026-07-01T12:34:56.789000Z')
  })

  it('acknowledge-all counts only what was still new and stores each one', async () => {
    const all = (await api.handle('POST', '/api/alerts/acknowledge-all')).body as { acknowledged: number }
    const total = ((await api.handle('GET', '/api/alerts?status=all')).body as unknown[]).length
    expect(all.acknowledged).toBe(total - 1)
    expect(Object.keys(await store.load())).toHaveLength(total)
    expect(((await api.handle('POST', '/api/alerts/acknowledge-all')).body as { acknowledged: number }).acknowledged).toBe(0)
  })

  it('an unknown alert is a 404 with the same message as the Mac app', async () => {
    expect(await api.handle('POST', '/api/alerts/424242/acknowledge')).toEqual({
      status: 404,
      body: { detail: 'No alert with id 424242' },
    })
  })
})

describe('fetch adapter', () => {
  it('answers /api/... as JSON and leaves other URLs to the network', async () => {
    const { api } = await fresh()
    let passed = ''
    const f = createFetch(api, (async (input: RequestInfo | URL) => {
      passed = String(input)
      return new Response('net')
    }) as typeof fetch)
    const r = await f('http://localhost/api/span?x=1')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/json')
    expect(await r.json()).toEqual({ first_day: '2026-03-01', last_day: '2026-06-30' })
    expect(await (await f('http://localhost/fonts/a.woff2')).text()).toBe('net')
    expect(passed).toBe('http://localhost/fonts/a.woff2')
    const bad = await f('/api/overview?from=2026-06-30&to=2026-03-01'.replace(/^/, 'http://localhost'))
    expect(bad.status).toBe(422)
    expect(await bad.json()).toEqual({ detail: "'from' must not be after 'to'" })
  })

  it('without data every data route is a 503 and health says so', async () => {
    const api = new Api()
    expect((await api.handle('GET', '/api/health')).body).toMatchObject({ status: 'ok', has_data: false })
    const r = await api.handle('GET', '/api/overview')
    expect(r.status).toBe(503)
    expect((r.body as { detail: string }).detail).toContain('import a data pack')
    expect((await api.handle('GET', '/api/nope')).status).toBe(404)
  })

  it('health reports data once a pack is loaded', async () => {
    const { api } = await fresh()
    expect((await api.handle('GET', '/api/health')).body).toMatchObject({ status: 'ok', has_data: true })
  })
})

describe('data packs', () => {
  it('rejects files that are not packs, with a message for the user', () => {
    expect(() => readPack(new TextEncoder().encode('hello'))).toThrow(PackError)
    expect(() => readPack(new TextEncoder().encode('hello'))).toThrow(/not a data pack/)
  })

  it('loading another pack replaces the data (nothing left over)', async () => {
    const raw = await nodeDb()
    const bytes = packBytes()
    const manifest = await loadPack(raw, bytes)
    await loadPack(raw, bytes)
    const con = new Con(raw)
    expect((await con.one('SELECT count(*) AS n FROM warning_events')).n).toBe(manifest.tables.warning_events.rows)
  })

  it('detects a damaged table', async () => {
    const { files, manifest } = readPack(packBytes())
    const { zipSync, strToU8 } = await import('fflate')
    manifest.tables.alerts.sha256 = '0'.repeat(64)
    const broken = zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(manifest)) }, { level: 0 })
    await expect(loadPack(await nodeDb(), broken)).rejects.toThrow(/checksum/)
  })
})

describe('helpers', () => {
  it('bind inlines parameters safely and ignores ? inside quotes', () => {
    expect(bind("SELECT '?' AS q, a FROM t WHERE x = ? AND y >= ? AND z = ?", ["it's", new Ts('2026-01-02 00:00:00'), 3])).toBe(
      "SELECT '?' AS q, a FROM t WHERE x = 'it''s' AND y >= TIMESTAMP '2026-01-02 00:00:00' AND z = 3",
    )
    expect(() => bind('SELECT ?', [])).toThrow()
    expect(() => bind('SELECT 1', [1])).toThrow()
  })

  it("pyRound matches Python's round (half to even on the exact value)", () => {
    expect(pyRound(0.25, 1)).toBe(0.2)
    expect(pyRound(0.35, 1)).toBe(0.3) // 0.35 is really 0.34999...
    expect(pyRound(1.115, 2)).toBe(1.11)
    expect(pyRound(2.675, 2)).toBe(2.67)
    expect(pyRound(7.5, 0)).toBe(8)
    expect(pyRound(6.5, 0)).toBe(6)
    expect(pyRound(-0.25, 1)).toBe(-0.2)
    expect(pyRound(123.456, 1)).toBe(123.5)
  })
})
