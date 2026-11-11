/**
 * Owns the data on the device: starts the engine, loads the stored packs (one per car model),
 * imports / switches / deletes. UI-free so it can be tested; the React side only subscribes to its state.
 *
 * One model is loaded in the engine at a time (the one the address names); the others stay stored and are
 * loaded when asked for. An import of another model's pack stores it without switching to it, so the
 * address and the data on screen never disagree.
 */
import { Api, type ModelInfo } from './engine/api'
import { replayAcks } from './engine/alerts'
import { Con, type RawDb } from './engine/db'
import { clearDatabase, loadPack, readPack, type Manifest } from './engine/pack'
import {
  deleteAllStoredData, deleteStoredModel, discardLegacyPack, ModelAckStore, readStoredPacks, readStoredSummaries,
  writeStoredPack, writeStoredSummary, type StoredPack,
} from './storage'

export type Status = 'starting' | 'empty' | 'loading' | 'ready' | 'error'

export interface PackInfo {
  name: string
  bytes: number
  savedAt: string
  manifest: Manifest
}

/** A pack stored on the device: one per car model. */
export interface ModelPack {
  id: string
  name: string
  info: PackInfo
}

/**
 * The version of the engine's monthly answer the cached summaries were made from. Raise it whenever
 * `/api/trends/monthly` (its fields or its maths) changes, so no summary of the old answer is ever shown.
 */
export const SUMMARY_VERSION = 1

export interface DataState {
  status: Status
  /** what is going on, for the loading screen */
  message: string
  /** the pack of the model loaded now (null = none) */
  info: PackInfo | null
  /** id of the model loaded now */
  current: string | null
  /** every pack stored on the device */
  packs: ModelPack[]
  /** the models whose monthly figures are cached for the Compare page (a car not loaded can only be compared from these) */
  summaries: string[]
  /** the comparison is being prepared: other cars are loaded one after the other, then the one shown again */
  preparing: boolean
  /** shown on the data screen; the data in use (if any) is untouched unless the status is 'error' without info */
  error: string | null
  /** the browser promised to keep the data (null = unknown / not asked yet) */
  persisted: boolean | null
  /** data that was on this phone before but is gone without the user deleting it (the browser removed it) */
  lost: { name: string; lastDay: string } | null
}

/** Remembers that data was imported, to tell "never had data" from "the browser removed it". */
export interface Memory {
  read(): { name: string; lastDay: string } | null
  write(value: { name: string; lastDay: string } | null): void
}

const KEY = 'cx5.had-data'
const MODEL_KEY = 'cx5.model' // the model last shown (the same key the Mac dashboard uses for its choice)

export const localMemory: Memory = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null')
    } catch {
      return null
    }
  },
  write(value) {
    try {
      if (value) localStorage.setItem(KEY, JSON.stringify(value))
      else localStorage.removeItem(KEY)
    } catch {
      /* private mode: nothing to remember with */
    }
  },
}

function savedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY)
  } catch {
    return null
  }
}

/** Asks the browser not to evict our data; resolves to whether it agreed. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    return null
  }
}

export interface ControllerDeps {
  startEngine: () => Promise<RawDb>
  /** The demo packs bundled with this build (one per demo model); throws when there are none. */
  fetchDemo?: () => Promise<Uint8Array[]>
  /** Called whenever the data behind the API changed (clear cached query results). */
  onDataChanged?: () => void
  api?: Api
  memory?: Memory
  /** Ask the browser to keep the data (default: navigator.storage.persist). */
  persist?: () => Promise<boolean | null>
  /** The model last shown, to start with (default: the one saved in localStorage). */
  lastModel?: () => string | null
}

const asInfo = (p: StoredPack): PackInfo => ({ name: p.name, bytes: p.bytes.byteLength, savedAt: p.savedAt, manifest: p.manifest })
const asPack = (p: StoredPack): ModelPack => ({ id: p.manifest.model.id, name: p.manifest.model.name, info: asInfo(p) })

export class DataController {
  readonly api: Api
  private state: DataState = {
    status: 'starting', message: 'Starting the data engine…', info: null, current: null, packs: [], summaries: [],
    preparing: false, error: null, persisted: null, lost: null,
  }
  private readonly listeners = new Set<() => void>()
  private raw: RawDb | null = null
  private engine: Promise<RawDb> | null = null
  private readonly acks = new ModelAckStore()
  private readonly memory: Memory
  private stored = new Map<string, StoredPack>()
  private summaryCache = new Map<string, unknown[]>()

  constructor(private readonly deps: ControllerDeps) {
    this.api = deps.api ?? new Api({ acks: this.acks })
    this.memory = deps.memory ?? localMemory
  }

  private async keepData(): Promise<void> {
    this.set({ persisted: await (this.deps.persist ?? requestPersistence)() })
  }

  getState = (): DataState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<DataState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  private engineReady(): Promise<RawDb> {
    this.engine ??= this.deps.startEngine().then((raw) => (this.raw = raw))
    return this.engine
  }

  /** The models for GET /api/models: the stored packs, the one loaded now being the default. */
  private publishModels(current: string | null): ModelInfo[] {
    const models = [...this.stored.values()].map((p): ModelInfo => ({
      id: p.manifest.model.id,
      name: p.manifest.model.name,
      platform: p.manifest.model.platform,
      default: p.manifest.model.id === current,
      hidden_pages: p.manifest.model.hidden_pages,
      has_data: true,
      first_day: p.manifest.first_data_day,
      last_day: p.manifest.last_data_day,
    }))
    this.api.setModels(models)
    return models
  }

  private packs(): ModelPack[] {
    return [...this.stored.values()].map(asPack)
  }

  private summaryKey(p: StoredPack): string {
    return `${SUMMARY_VERSION}:${p.savedAt}`
  }

  /** Puts the cached summaries (those still made from the pack and the answer version stored now) into the engine. */
  private publishSummaries(): void {
    this.api.setSummaries(this.summaryCache)
    this.set({ summaries: [...this.summaryCache.keys()].filter((id) => this.stored.has(id)) })
  }

  private async loadSummaries(): Promise<void> {
    const saved = await readStoredSummaries()
    this.summaryCache = new Map(
      Object.entries(saved)
        .filter(([id, s]) => this.stored.has(id) && s.key === this.summaryKey(this.stored.get(id)!))
        .map(([id, s]) => [id, s.monthly]),
    )
  }

  /** The monthly figures of the model loaded now, over all its data, kept for the Compare page (once per pack). */
  private async summariseLoaded(stored: StoredPack): Promise<void> {
    const id = stored.manifest.model.id
    if (this.summaryCache.has(id)) return
    const answer = await this.api.handle('GET', '/api/trends/monthly')
    if (answer.status !== 200 || !Array.isArray(answer.body)) return // the comparison just will not offer this car
    this.summaryCache.set(id, answer.body)
    await writeStoredSummary(id, { key: this.summaryKey(stored), monthly: answer.body })
  }

  /** On launch: start the engine and load the model last shown (or the one the address asks for). */
  async init(requested?: string | null): Promise<void> {
    try {
      const [raw, packs, legacy] = await Promise.all([this.engineReady(), readStoredPacks(), discardLegacyPack()])
      this.stored = new Map(packs.map((p) => [p.manifest.model.id, p]))
      await this.loadSummaries()
      if (!packs.length) {
        // data that was here before and is not any more: the browser removed it (iOS does that to sites not opened for a while)
        this.publishModels(null)
        return this.set({
          status: 'empty', message: '', info: null, current: null, packs: [], lost: this.memory.read(),
          error: legacy
            ? 'The data pack stored on this phone was made by an older version of the app and can no longer be read. Import it again (make mobile-pack).'
            : null,
        })
      }
      const wanted = [requested, (this.deps.lastModel ?? savedModel)()].find((id) => id && this.stored.has(id))
      await this.activate(raw, this.stored.get(wanted ?? packs[0].manifest.model.id)!)
    } catch (e) {
      this.set({ status: 'error', message: '', error: describe(e) })
    }
  }

  private async activate(raw: RawDb, stored: StoredPack): Promise<void> {
    const id = stored.manifest.model.id
    this.set({ status: 'loading', message: `Loading ${stored.manifest.model.name}…` })
    // a copy: the engine takes the buffers it is given, and the stored pack is loaded again on every switch
    const manifest = await loadPack(raw, stored.bytes.slice())
    this.acks.use(id)
    await replayAcks(new Con(raw), this.acks)
    this.api.use(raw, id)
    this.stored.set(id, { ...stored, manifest })
    await this.summariseLoaded(stored)
    this.publishSummaries()
    this.publishModels(id)
    this.deps.onDataChanged?.()
    this.memory.write({ name: stored.name, lastDay: manifest.last_data_day })
    this.set({ status: 'ready', message: '', info: asInfo({ ...stored, manifest }), current: id, packs: this.packs(), error: null, lost: null })
    void this.keepData()
  }

  /** Loads another stored model into the engine. A failure keeps (or brings back) the model that was shown. */
  async switchTo(id: string): Promise<boolean> {
    const stored = this.stored.get(id)
    const previous = this.state.current
    if (!stored || id === previous) return Boolean(stored)
    try {
      this.api.use(null)
      await this.activate(await this.engineReady(), stored)
      return true
    } catch (e) {
      const message = describe(e)
      const back = previous ? this.stored.get(previous) : undefined
      try {
        if (back) await this.activate(await this.engineReady(), back)
      } catch {
        /* reported below */
      }
      this.set({ error: message })
      return false
    }
  }

  /**
   * Validates a pack file and stores it as the pack of the model it holds (replacing that model's
   * earlier pack). It becomes the model on screen when it replaces the one shown or when there was none;
   * otherwise it is only stored, and the model switcher offers it. A bad file changes nothing.
   */
  async importPack(bytes: Uint8Array, name: string, options: { show?: boolean } = {}): Promise<boolean> {
    const previous = this.state.current
    try {
      const { manifest } = readPack(bytes) // refuses a wrong file before anything is touched
      const raw = await this.engineReady()
      const stored: StoredPack = { bytes, name, savedAt: new Date().toISOString(), manifest }
      const id = manifest.model.id
      this.summaryCache.delete(id) // a new pack: its cached figures are of the old one
      const show = options.show ?? (previous === null || previous === id)
      if (show) {
        this.api.use(null)
        await this.activate(raw, stored)
        await writeStoredPack(stored)
      } else {
        await writeStoredPack(stored)
        this.stored.set(id, stored)
        this.publishSummaries()
        this.publishModels(previous)
        this.deps.onDataChanged?.()
        this.set({ packs: this.packs(), error: null })
      }
      return true
    } catch (e) {
      const message = describe(e)
      if (previous) {
        // the old data may have been cleared before the failure: bring it back from storage
        try {
          const stored = (await readStoredPacks()).find((p) => p.manifest.model.id === previous)
          if (stored) await this.activate(await this.engineReady(), stored)
        } catch {
          /* reported below */
        }
        this.set({ error: message })
      } else {
        this.set({ status: 'empty', message: '', info: null, error: message })
      }
      return false
    }
  }

  /** Imports every demo pack (one per demo model); the first one is shown. */
  async loadDemo(): Promise<boolean> {
    try {
      if (!this.deps.fetchDemo) throw new Error('This build has no demo data.')
      const packs = await this.deps.fetchDemo()
      if (!packs.length) throw new Error('This build has no demo data.')
      for (const [i, bytes] of packs.entries()) {
        if (!(await this.importPack(bytes, 'demo', { show: i === 0 }))) return false
      }
      return true
    } catch (e) {
      this.set({ error: describe(e) })
      return false
    }
  }

  /** Removes one model's pack. When it was the one shown, another stored model is shown (or none is left). */
  async deleteModel(id: string): Promise<void> {
    if (!this.stored.has(id)) return
    const wasCurrent = this.state.current === id
    if (wasCurrent) this.api.use(null)
    await deleteStoredModel(id)
    this.stored.delete(id)
    this.summaryCache.delete(id)
    this.publishSummaries()
    const next = [...this.stored.values()][0]
    if (!next) return this.deleteAll()
    if (wasCurrent) {
      if (this.raw) await clearDatabase(this.raw)
      await this.activate(await this.engineReady(), next)
    } else {
      this.publishModels(this.state.current)
      this.deps.onDataChanged?.()
      this.set({ packs: this.packs() })
    }
  }

  async deleteAll(): Promise<void> {
    this.api.use(null)
    if (this.raw) await clearDatabase(this.raw)
    await deleteAllStoredData()
    this.stored.clear()
    this.summaryCache.clear()
    this.publishSummaries()
    this.publishModels(null)
    this.memory.write(null) // deleted on purpose: not "lost"
    this.deps.onDataChanged?.()
    this.set({ status: 'empty', message: '', info: null, current: null, packs: [], summaries: [], error: null, lost: null })
  }

  /**
   * Makes sure every stored car has its monthly figures cached, so the Compare page can show a car that is not
   * loaded. A pack that has never been loaded since it was imported is loaded now, one after the other, and the
   * model that was shown is loaded again at the end. The status stays `loading` for the whole time.
   */
  async prepareComparison(): Promise<boolean> {
    const original = this.state.current
    const missing = [...this.stored.keys()].filter((id) => !this.summaryCache.has(id))
    if (!original || this.state.preparing || !missing.length) return true
    this.set({ preparing: true, status: 'loading', message: 'Preparing the comparison…' })
    try {
      const raw = await this.engineReady()
      for (const id of missing) {
        const stored = this.stored.get(id)!
        this.set({ message: `Preparing the comparison: loading ${stored.manifest.model.name}…` })
        this.api.use(null)
        await loadPack(raw, stored.bytes.slice())
        this.api.use(raw, id)
        await this.summariseLoaded(stored)
      }
      return true
    } catch (e) {
      this.set({ error: describe(e) })
      return false
    } finally {
      // back to the car that was shown, whatever happened
      try {
        this.api.use(null)
        await this.activate(await this.engineReady(), this.stored.get(original)!)
      } catch (e) {
        this.set({ status: 'error', message: '', error: describe(e) })
      }
      this.set({ preparing: false })
    }
  }

  clearError(): void {
    this.set({ error: null })
  }
}

function describe(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}
