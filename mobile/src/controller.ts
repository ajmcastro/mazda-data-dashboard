/**
 * Owns the data on the device: starts the engine, loads the stored pack, imports / replaces /
 * deletes. UI-free so it can be tested; the React side only subscribes to its state.
 */
import { Api } from './engine/api'
import { replayAcks } from './engine/alerts'
import { Con, type RawDb } from './engine/db'
import { clearDatabase, loadPack, readPack, type Manifest } from './engine/pack'
import {
  deleteStoredData, IdbAckStore, readStoredPack, writeStoredPack, type StoredPack,
} from './storage'

export type Status = 'starting' | 'empty' | 'loading' | 'ready' | 'error'

export interface PackInfo {
  name: string
  bytes: number
  savedAt: string
  manifest: Manifest
}

export interface DataState {
  status: Status
  /** what is going on, for the loading screen */
  message: string
  info: PackInfo | null
  /** shown on the data screen; the data in use (if any) is untouched unless the status is 'error' without info */
  error: string | null
}

export interface ControllerDeps {
  startEngine: () => Promise<RawDb>
  /** The demo pack bundled with this build; throws when there is none. */
  fetchDemo?: () => Promise<Uint8Array>
  /** Called whenever the data behind the API changed (clear cached query results). */
  onDataChanged?: () => void
  api?: Api
}

const asInfo = (p: StoredPack): PackInfo => ({ name: p.name, bytes: p.bytes.byteLength, savedAt: p.savedAt, manifest: p.manifest })

export class DataController {
  readonly api: Api
  private state: DataState = { status: 'starting', message: 'Starting the data engine…', info: null, error: null }
  private readonly listeners = new Set<() => void>()
  private raw: RawDb | null = null
  private engine: Promise<RawDb> | null = null
  private readonly acks = new IdbAckStore()

  constructor(private readonly deps: ControllerDeps) {
    this.api = deps.api ?? new Api({ acks: this.acks })
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

  /** On launch: start the engine and load whatever is stored. */
  async init(): Promise<void> {
    try {
      const [raw, stored] = await Promise.all([this.engineReady(), readStoredPack()])
      if (!stored) return this.set({ status: 'empty', message: '', info: null })
      await this.activate(raw, stored)
    } catch (e) {
      this.set({ status: 'error', message: '', error: describe(e) })
    }
  }

  private async activate(raw: RawDb, stored: StoredPack): Promise<void> {
    this.set({ status: 'loading', message: 'Loading your data…' })
    const manifest = await loadPack(raw, stored.bytes)
    await replayAcks(new Con(raw), this.acks)
    this.api.use(raw)
    this.deps.onDataChanged?.()
    this.set({ status: 'ready', message: '', info: asInfo({ ...stored, manifest }), error: null })
  }

  /** Validates a pack file, replaces the data with it and stores it. A bad file changes nothing. */
  async importPack(bytes: Uint8Array, name: string): Promise<boolean> {
    const previous = this.state.info
    try {
      const { manifest } = readPack(bytes) // refuses a wrong file before anything is touched
      const raw = await this.engineReady()
      const stored: StoredPack = { bytes, name, savedAt: new Date().toISOString(), manifest }
      this.api.use(null)
      await this.activate(raw, stored)
      await writeStoredPack(stored)
      return true
    } catch (e) {
      const message = describe(e)
      if (previous) {
        // the old data may have been cleared before the failure: bring it back from storage
        try {
          const stored = await readStoredPack()
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

  async loadDemo(): Promise<boolean> {
    try {
      if (!this.deps.fetchDemo) throw new Error('This build has no demo data.')
      return await this.importPack(await this.deps.fetchDemo(), 'demo')
    } catch (e) {
      this.set({ error: describe(e) })
      return false
    }
  }

  async deleteData(): Promise<void> {
    this.api.use(null)
    if (this.raw) await clearDatabase(this.raw)
    await deleteStoredData()
    this.deps.onDataChanged?.()
    this.set({ status: 'empty', message: '', info: null, error: null })
  }

  clearError(): void {
    this.set({ error: null })
  }
}

function describe(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}
