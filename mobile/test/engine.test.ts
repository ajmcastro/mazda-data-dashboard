import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Api, createFetch } from '../src/engine/api'
import { MemoryAckStore, replayAcks } from '../src/engine/alerts'
import { bind, Con, Ts } from '../src/engine/db'
import { loadPack, PackError, readPack } from '../src/engine/pack'
import { pyRound } from '../src/engine/pyround'
import { nodeDb } from './support/node-db'

const packFile = (model: string) => new URL(`../contract/${model}/sample.cx5pack`, import.meta.url)
const packBytes = (model = 'cx5') => new Uint8Array(readFileSync(packFile(model)))
const clock = () => new Date('2026-07-01T12:34:56.789000Z')

async function fresh(store = new MemoryAckStore()) {
  const raw = await nodeDb()
  await loadPack(raw, packBytes())
  await replayAcks(new Con(raw), store)
  const api = new Api({ acks: store, now: clock })
  api.use(raw, 'cx5')
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

describe('car models', () => {
  const models = [
    { id: 'cx5', name: 'Mazda CX-5', platform: '24PF', default: true, hidden_pages: [], body: { length_mm: 4575, width_mm: null, height_mm: null, wheelbase_mm: 2700, track_mm: null, wheel_diameter_mm: null, steering: 'left' as const }, has_data: true, first_day: '2026-03-01', last_day: '2026-06-30' },
    { id: 'cx60', name: 'Mazda CX-60', platform: null, default: false, hidden_pages: ['trends'], body: null, has_data: true, first_day: '2026-04-10', last_day: '2026-07-31' },
  ]
  let api: Api
  beforeAll(async () => {
    ;({ api } = await fresh())
    api.setModels(models)
  }, 120_000)

  it('lists the models of the stored packs', async () => {
    expect(await api.handle('GET', '/api/models')).toEqual({ status: 200, body: models })
  })

  it('answers for the loaded model, named or not', async () => {
    const plain = await api.handle('GET', '/api/span')
    expect(plain.status).toBe(200)
    expect(await api.handle('GET', '/api/span?model=cx5')).toEqual(plain)
    expect((await api.handle('GET', '/api/health?model=cx5')).status).toBe(200)
  })

  it('refuses to answer for a model that is not the one loaded, like the Python API does for an unknown one', async () => {
    for (const url of ['/api/span?model=cx60', '/api/overview?model=nope', '/api/alerts?model=cx60']) {
      expect(await api.handle('GET', url)).toEqual({ status: 404, body: { detail: expect.stringMatching(/^Unknown model '\w+'; the models are: cx5, cx60$/) } })
    }
    expect((await api.handle('POST', '/api/alerts/acknowledge-all?model=cx60')).status).toBe(404)
    expect((await api.handle('GET', '/api/models?model=cx60')).status).toBe(200) // the list itself is not about one model
  })

  it('has no data to refuse for before a pack is loaded: the list is empty and data routes say so', async () => {
    const empty = new Api()
    expect(await empty.handle('GET', '/api/models')).toEqual({ status: 200, body: [] })
    expect((await empty.handle('GET', '/api/span')).status).toBe(503)
  })
})

describe('the pack names its car model', () => {
  it('carries id, name, platform and hidden pages, and the format is 2', () => {
    const { manifest } = readPack(packBytes('cx60'))
    expect(manifest.format).toBe(2)
    expect(manifest.model).toMatchObject({ id: 'cx60', name: 'Mazda CX-60', hidden_pages: [] })
    expect(readPack(packBytes('cx5')).manifest.model).toMatchObject({ id: 'cx5', name: 'Mazda CX-5', platform: '24PF' })
    // the dimensions for the 3D drawing travel with the pack (M41); the figures themselves are the owner's to set
    const body = manifest.model.body
    expect(body?.steering === 'left' || body?.steering === 'right').toBe(true)
    expect(typeof body?.length_mm).toBe('number')
  })

  it('refuses a pack of the older format, or one that does not say its model, with a message', async () => {
    const { files, manifest } = readPack(packBytes())
    const { zipSync, strToU8 } = await import('fflate')
    const pack = (m: object) => zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(m)) }, { level: 0 })
    expect(() => readPack(pack({ ...manifest, format: 1 }))).toThrow(/format 1; this app reads format 2/)
    const { model: _gone, ...noModel } = manifest
    expect(() => readPack(pack(noModel))).toThrow(/does not say which car model/)
  })
})

describe('summaries of cars that are not loaded', () => {
  let api: Api
  beforeAll(async () => {
    ;({ api } = await fresh())
    api.setSummaries(new Map([['cx60', { monthly: [{ month: '2026-05' }], garage: { has_data: true, alerts_new: 3 } }]]))
  }, 120_000)

  it('answers the all-time monthly figures of that car from its summary', async () => {
    expect(await api.handle('GET', '/api/trends/monthly?model=cx60')).toEqual({ status: 200, body: [{ month: '2026-05' }] })
  })
  it('the loaded car is answered by the engine, not by a summary', async () => {
    api.setSummaries(new Map([['cx5', { monthly: [{ month: 'from-summary' }], garage: { alerts_new: -1 } }]]))
    const res = await api.handle('GET', '/api/trends/monthly?model=cx5')
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('from-summary')
    api.setSummaries(new Map([['cx60', { monthly: [{ month: '2026-05' }], garage: { has_data: true, alerts_new: 3 } }]]))
  })
  it('refuses a period, other routes, other methods and cars without a summary', async () => {
    api.setModels([])
    for (const url of ['/api/trends/monthly?model=cx60&from=2026-05-01', '/api/trends/monthly?model=cx60&to=2026-06-01', '/api/span?model=cx60', '/api/trends/monthly?model=mx30']) {
      expect((await api.handle('GET', url)).status, url).toBe(404)
    }
    expect((await api.handle('POST', '/api/trends/monthly?model=cx60')).status).toBe(405)
  })

  it('answers the "All cars" card of that car from its summary, and refuses it with a period it does not have', async () => {
    expect(await api.handle('GET', '/api/garage?model=cx60')).toEqual({ status: 200, body: { has_data: true, alerts_new: 3 } })
    const own = await api.handle('GET', '/api/garage?model=cx5') // the loaded car: live, never the summary
    expect(own.status).toBe(200)
    expect(JSON.stringify(own.body)).not.toContain('-1')
    expect((await api.handle('GET', '/api/garage?model=mx30')).status).toBe(404)
    expect((await api.handle('GET', '/api/garage')).status).toBe(200) // no model named: the loaded car
  })
})

