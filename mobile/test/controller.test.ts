import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { DataController } from '../src/controller'
import { readStoredPack } from '../src/storage'
import { nodeDb } from './support/node-db'

const pack = () => new Uint8Array(readFileSync(new URL('../contract/sample.cx5pack', import.meta.url)))

// a "launch" of the app: a new controller (and engine) over the same browser storage
const launch = () => new DataController({ startEngine: nodeDb, fetchDemo: async () => pack() })

async function wipe() {
  const c = launch()
  await c.deleteData()
}

describe('data on the device', () => {
  beforeEach(wipe, 60_000)

  it('starts empty, imports a pack, and keeps it for the next launch', async () => {
    const first = launch()
    await first.init()
    expect(first.getState().status).toBe('empty')

    expect(await first.importPack(pack(), 'mazda.cx5pack')).toBe(true)
    expect(first.getState()).toMatchObject({ status: 'ready', error: null })
    expect(first.getState().info).toMatchObject({ name: 'mazda.cx5pack' })
    expect(first.getState().info?.manifest.last_data_day).toBe('2026-06-30')
    expect((await first.api.handle('GET', '/api/span')).body).toEqual({ first_day: '2026-03-01', last_day: '2026-06-30' })

    const second = launch()
    await second.init()
    expect(second.getState().status).toBe('ready')
    expect((await second.api.handle('GET', '/api/span')).status).toBe(200)
  }, 120_000)

  it('a wrong file is refused with a message and changes nothing', async () => {
    const c = launch()
    await c.init()
    await c.importPack(pack(), 'good.cx5pack')
    expect(await c.importPack(new TextEncoder().encode('not a pack'), 'notes.txt')).toBe(false)
    expect(c.getState().status).toBe('ready')
    expect(c.getState().error).toMatch(/not a data pack/)
    expect(c.getState().info?.name).toBe('good.cx5pack')
    expect((await c.api.handle('GET', '/api/overview')).status).toBe(200)
    expect((await readStoredPack())?.name).toBe('good.cx5pack')
  }, 120_000)

  it('a wrong file with no data yet leaves the empty screen with the message', async () => {
    const c = launch()
    await c.init()
    expect(await c.importPack(new Uint8Array([1, 2, 3]), 'x')).toBe(false)
    expect(c.getState()).toMatchObject({ status: 'empty' })
    expect(c.getState().error).toBeTruthy()
    expect((await c.api.handle('GET', '/api/overview')).status).toBe(503)
  }, 60_000)

  it('demo data loads like an import', async () => {
    const c = launch()
    await c.init()
    expect(await c.loadDemo()).toBe(true)
    expect(c.getState().info?.name).toBe('demo')
  }, 120_000)

  it('a build without demo data says so', async () => {
    const c = new DataController({ startEngine: nodeDb })
    await c.init()
    expect(await c.loadDemo()).toBe(false)
    expect(c.getState().error).toMatch(/no demo data/)
  }, 60_000)

  it('delete removes the data and its acknowledgements from the device', async () => {
    const c = launch()
    await c.init()
    await c.importPack(pack(), 'p.cx5pack')
    await c.api.handle('POST', '/api/alerts/acknowledge-all')
    await c.deleteData()
    expect(c.getState()).toMatchObject({ status: 'empty', info: null })
    expect((await c.api.handle('GET', '/api/span')).status).toBe(503)
    expect(await readStoredPack()).toBeNull()

    const again = launch()
    await again.init()
    expect(again.getState().status).toBe('empty')
    await again.importPack(pack(), 'p.cx5pack')
    expect(((await again.api.handle('GET', '/api/alerts?status=new')).body as unknown[]).length).toBeGreaterThan(0)
  }, 180_000)

  it('acknowledgements survive a relaunch', async () => {
    const c = launch()
    await c.init()
    await c.importPack(pack(), 'p.cx5pack')
    const newAlerts = (await c.api.handle('GET', '/api/alerts?status=new')).body as { alert_id: number }[]
    await c.api.handle('POST', `/api/alerts/${newAlerts[0].alert_id}/acknowledge`)

    const next = launch()
    await next.init()
    const left = (await next.api.handle('GET', '/api/alerts?status=new')).body as unknown[]
    expect(left).toHaveLength(newAlerts.length - 1)
  }, 120_000)
})
