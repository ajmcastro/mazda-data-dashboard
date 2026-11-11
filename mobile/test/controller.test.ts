import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataController } from '../src/controller'
import { readStoredPacks } from '../src/storage'
import { nodeDb } from './support/node-db'

const packOf = (model: string) => new Uint8Array(readFileSync(new URL(`../contract/${model}/sample.cx5pack`, import.meta.url)))
const pack = () => packOf('cx5')

// a "launch" of the app: a new controller (and engine) over the same browser storage
let remembered: { name: string; lastDay: string } | null = null
let lastShown: string | null = null
const memory = { read: () => remembered, write: (v: { name: string; lastDay: string } | null) => void (remembered = v) }
const launch = (persist: () => Promise<boolean | null> = async () => true) =>
  new DataController({ startEngine: nodeDb, fetchDemo: async () => [packOf('cx5'), packOf('cx60')], memory, persist, lastModel: () => lastShown })

async function wipe() {
  const c = launch()
  await c.deleteAll()
  remembered = null
  lastShown = null
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
    expect((await readStoredPacks()).map((p) => p.name)).toEqual(['good.cx5pack'])
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
    // both demo cars are stored; the first one is shown
    expect(c.getState().packs.map((p) => p.id)).toEqual(['cx5', 'cx60'])
    expect(c.getState().current).toBe('cx5')
  }, 180_000)

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
    await c.deleteAll()
    expect(c.getState()).toMatchObject({ status: 'empty', info: null })
    expect((await c.api.handle('GET', '/api/span')).status).toBe(503)
    expect(await readStoredPacks()).toEqual([])

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

  it('asks the browser to keep the data and says whether it agreed', async () => {
    const yes = launch(async () => true)
    await yes.init()
    await yes.importPack(pack(), 'p.cx5pack')
    await vi.waitFor(() => expect(yes.getState().persisted).toBe(true))

    const no = launch(async () => false)
    await no.init()
    await vi.waitFor(() => expect(no.getState().persisted).toBe(false))
  }, 120_000)

  it('notices data the browser removed (but not data the user deleted)', async () => {
    const c = launch()
    await c.init()
    await c.importPack(pack(), 'mazda.cx5pack')
    expect(remembered).toMatchObject({ name: 'mazda.cx5pack', lastDay: '2026-06-30' })

    // the browser evicts the stored pack behind the app's back
    const { deleteAllStoredData } = await import('../src/storage')
    await deleteAllStoredData()
    const next = launch()
    await next.init()
    expect(next.getState()).toMatchObject({ status: 'empty', lost: { name: 'mazda.cx5pack', lastDay: '2026-06-30' } })

    // importing again clears the notice; deleting on purpose leaves none
    await next.importPack(pack(), 'mazda.cx5pack')
    expect(next.getState().lost).toBeNull()
    await next.deleteAll()
    const last = launch()
    await last.init()
    expect(last.getState().lost).toBeNull()
  }, 180_000)
})

describe('several car models on the device', () => {
  beforeEach(wipe, 60_000)

  const span = async (c: DataController) => (await c.api.handle('GET', '/api/span')).body

  it('stores a second model without switching to it, then switches when asked', async () => {
    const c = launch()
    await c.init()
    await c.importPack(packOf('cx5'), 'mine-cx5.cx5pack')
    expect(await c.importPack(packOf('cx60'), 'mine-cx60.cx5pack')).toBe(true)
    // the model on screen did not change under the address
    expect(c.getState()).toMatchObject({ status: 'ready', current: 'cx5' })
    expect(c.getState().packs.map((p) => [p.id, p.name])).toEqual([['cx5', 'Mazda CX-5'], ['cx60', 'Mazda CX-60']])
    expect(await span(c)).toEqual({ first_day: '2026-03-01', last_day: '2026-06-30' })

    const models = (await c.api.handle('GET', '/api/models')).body as { id: string; default: boolean; last_day: string }[]
    expect(models.map((m) => [m.id, m.default, m.last_day])).toEqual([['cx5', true, '2026-06-30'], ['cx60', false, '2026-07-31']])
    expect((await c.api.handle('GET', '/api/span?model=cx60')).status).toBe(404) // not loaded yet

    expect(await c.switchTo('cx60')).toBe(true)
    expect(c.getState()).toMatchObject({ status: 'ready', current: 'cx60', info: { name: 'mine-cx60.cx5pack' } })
    expect(await span(c)).toEqual({ first_day: '2026-04-10', last_day: '2026-07-31' })
    expect((await c.api.handle('GET', '/api/span?model=cx60')).status).toBe(200)
    expect((await c.api.handle('GET', '/api/span?model=cx5')).status).toBe(404)
    const after = (await c.api.handle('GET', '/api/models')).body as { id: string; default: boolean }[]
    expect(after.map((m) => [m.id, m.default])).toEqual([['cx5', false], ['cx60', true]])
    expect(await c.switchTo('nope')).toBe(false)
    expect(c.getState().current).toBe('cx60')
  }, 240_000)

  it('importing the pack of the model on screen replaces it', async () => {
    const c = launch()
    await c.init()
    await c.importPack(packOf('cx5'), 'old.cx5pack')
    await c.importPack(packOf('cx5'), 'new.cx5pack')
    expect(c.getState().packs).toHaveLength(1)
    expect(c.getState().info?.name).toBe('new.cx5pack')
  }, 180_000)

  it('opens on the model last shown, or the one a link asks for', async () => {
    const c = launch()
    await c.init()
    await c.importPack(packOf('cx5'), 'a.cx5pack')
    await c.importPack(packOf('cx60'), 'b.cx5pack')

    lastShown = 'cx60'
    const next = launch()
    await next.init()
    expect(next.getState().current).toBe('cx60')

    const linked = launch()
    await linked.init('cx5') // #/?model=cx5 wins over what was shown last
    expect(linked.getState().current).toBe('cx5')

    const unknown = launch()
    await unknown.init('cx70')
    expect(unknown.getState().current).toBe('cx60') // an unknown model falls back to the last shown one
  }, 300_000)

  it('keeps acknowledgements apart per model', async () => {
    const c = launch()
    await c.init()
    await c.importPack(packOf('cx5'), 'a.cx5pack')
    await c.importPack(packOf('cx60'), 'b.cx5pack')
    const count = async (x: DataController) => ((await x.api.handle('GET', '/api/alerts?status=new')).body as unknown[]).length
    const cx5Before = await count(c)
    await c.api.handle('POST', '/api/alerts/acknowledge-all')
    expect(await count(c)).toBe(0)

    await c.switchTo('cx60')
    expect(await count(c)).toBeGreaterThan(0) // the other car's alerts are untouched
    const cx60Before = await count(c)
    const first = ((await c.api.handle('GET', '/api/alerts?status=new')).body as { alert_id: number }[])[0]
    await c.api.handle('POST', `/api/alerts/${first.alert_id}/acknowledge`)

    const again = launch()
    lastShown = 'cx5'
    await again.init()
    expect(await count(again)).toBe(0) // still all acknowledged
    await again.switchTo('cx60')
    expect(await count(again)).toBe(cx60Before - 1)
    expect(cx5Before).toBeGreaterThan(0)
  }, 300_000)

  it('deleting a model leaves the other; deleting the one on screen shows the other', async () => {
    const c = launch()
    await c.init()
    await c.importPack(packOf('cx5'), 'a.cx5pack')
    await c.importPack(packOf('cx60'), 'b.cx5pack')
    await c.deleteModel('cx60') // not the one shown
    expect(c.getState()).toMatchObject({ status: 'ready', current: 'cx5' })
    expect(c.getState().packs.map((p) => p.id)).toEqual(['cx5'])
    expect((await readStoredPacks()).map((p) => p.manifest.model.id)).toEqual(['cx5'])

    await c.importPack(packOf('cx60'), 'b.cx5pack')
    await c.deleteModel('cx5') // the one shown
    expect(c.getState()).toMatchObject({ status: 'ready', current: 'cx60' })
    expect(await span(c)).toEqual({ first_day: '2026-04-10', last_day: '2026-07-31' })

    await c.deleteModel('cx60') // the last one
    expect(c.getState()).toMatchObject({ status: 'empty', info: null, packs: [] })
    expect((await c.api.handle('GET', '/api/models')).body).toEqual([])
  }, 400_000)

  it('discards the pack of the first version of the app, saying why', async () => {
    const c = launch()
    await c.init() // creates the storage
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('cx5', 2)
      open.onsuccess = () => {
        const t = open.result.transaction(['pack'], 'readwrite')
        t.objectStore('pack').put({ name: 'old.cx5pack' }, 'current')
        t.oncomplete = () => (open.result.close(), resolve())
        t.onerror = () => reject(t.error)
      }
    })
    const next = launch()
    await next.init()
    expect(next.getState()).toMatchObject({ status: 'empty', packs: [] })
    expect(next.getState().error).toMatch(/older version of the app/)
    const later = launch()
    await later.init()
    expect(later.getState().error).toBeNull() // it was removed, so the message is shown once
  }, 120_000)
})

