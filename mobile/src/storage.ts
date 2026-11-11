/**
 * What the phone keeps between launches (IndexedDB): one data pack per car model, and the
 * acknowledgements made on the phone (keyed by model, so two cars never share them).
 */
import type { AckStore } from './engine/alerts'
import type { Manifest } from './engine/pack'

export interface StoredPack {
  bytes: Uint8Array
  /** file name it was imported from (or 'demo') */
  name: string
  savedAt: string
  manifest: Manifest
}

const DB = 'cx5'
const VERSION = 3 // 3: the summaries store
const LEGACY_PACK = 'pack' // version 1 kept a single pack here (format 1: it can no longer be read)
const PACKS = 'packs'
const ACKS = 'acks'
const SUMMARIES = 'summaries'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const store of [LEGACY_PACK, PACKS, ACKS, SUMMARIES]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Cannot open the storage of this browser'))
  })
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(stores, mode)
      const req = run(t)
      t.oncomplete = () => resolve(req ? req.result : undefined)
      t.onerror = () => reject(t.error ?? new Error('Storage failed'))
      t.onabort = () => reject(t.error ?? new Error('Storage failed'))
    })
  } finally {
    db.close()
  }
}

/** Every stored pack, in the order the models were first imported. */
export async function readStoredPacks(): Promise<StoredPack[]> {
  const all = (await tx([PACKS], 'readonly', (t) => t.objectStore(PACKS).getAll())) as StoredPack[] | undefined
  return [...(all ?? [])].sort((a, b) => (a.manifest.model.id < b.manifest.model.id ? -1 : 1))
}

/** Stores (or replaces) the pack of the model it holds. */
export async function writeStoredPack(pack: StoredPack): Promise<void> {
  await tx([PACKS], 'readwrite', (t) => void t.objectStore(PACKS).put(pack, pack.manifest.model.id))
}

/**
 * What the Compare and "All cars" pages need of a car that is not loaded in the engine: its monthly figures
 * over all its data (the answer of `/api/trends/monthly` without a period) and its `/api/garage` card. Kept with a key that says which pack and
 * which version of the engine's answer it was made from, so a replaced pack or a changed answer discards it.
 */
export interface StoredSummary {
  key: string
  monthly: unknown[]
  garage: unknown
}

export async function readStoredSummaries(): Promise<Record<string, StoredSummary>> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const out: Record<string, StoredSummary> = {}
      const req = db.transaction([SUMMARIES], 'readonly').objectStore(SUMMARIES).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return resolve(out)
        out[String(cursor.key)] = cursor.value as StoredSummary
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function writeStoredSummary(model: string, summary: StoredSummary): Promise<void> {
  await tx([SUMMARIES], 'readwrite', (t) => void t.objectStore(SUMMARIES).put(summary, model))
}

/** A pack left by the first version of the app (before several models); it is removed when found. */
export async function discardLegacyPack(): Promise<boolean> {
  const found = await tx([LEGACY_PACK], 'readonly', (t) => t.objectStore(LEGACY_PACK).count())
  if (!found) return false
  await tx([LEGACY_PACK, ACKS], 'readwrite', (t) => {
    t.objectStore(LEGACY_PACK).clear()
    t.objectStore(ACKS).clear() // its acknowledgements were not keyed by model
  })
  return true
}

const prefix = (model: string) => `${model}:`

/** Removes one model's pack and the acknowledgements that belong to it. */
export async function deleteStoredModel(model: string): Promise<void> {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction([PACKS, ACKS, SUMMARIES], 'readwrite')
      t.objectStore(PACKS).delete(model)
      t.objectStore(SUMMARIES).delete(model)
      const acks = t.objectStore(ACKS)
      const req = acks.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        if (String(cursor.key).startsWith(prefix(model))) cursor.delete()
        cursor.continue()
      }
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error ?? new Error('Storage failed'))
      t.onabort = () => reject(t.error ?? new Error('Storage failed'))
    })
  } finally {
    db.close()
  }
}

/** Removes every pack and every acknowledgement. */
export async function deleteAllStoredData(): Promise<void> {
  await tx([PACKS, ACKS, LEGACY_PACK, SUMMARIES], 'readwrite', (t) => {
    t.objectStore(PACKS).clear()
    t.objectStore(ACKS).clear()
    t.objectStore(SUMMARIES).clear()
    t.objectStore(LEGACY_PACK).clear()
  })
}

/** The acknowledgements of one car model. */
export class IdbAckStore implements AckStore {
  constructor(private readonly model: string) {}

  async load(): Promise<Record<string, string>> {
    const db = await open()
    const p = prefix(this.model)
    try {
      return await new Promise((resolve, reject) => {
        const out: Record<string, string> = {}
        const req = db.transaction([ACKS], 'readonly').objectStore(ACKS).openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) return resolve(out)
          const key = String(cursor.key)
          if (key.startsWith(p)) out[key.slice(p.length)] = cursor.value as string
          cursor.continue()
        }
        req.onerror = () => reject(req.error)
      })
    } finally {
      db.close()
    }
  }

  async save(dedupKey: string, at: string): Promise<void> {
    await tx([ACKS], 'readwrite', (t) => void t.objectStore(ACKS).put(at, prefix(this.model) + dedupKey))
  }
}

/** The acknowledgement store the engine uses: it follows the car model that is loaded. */
export class ModelAckStore implements AckStore {
  private model = ''

  use(model: string): void {
    this.model = model
  }

  load(): Promise<Record<string, string>> {
    return new IdbAckStore(this.model).load()
  }

  save(dedupKey: string, at: string): Promise<void> {
    return new IdbAckStore(this.model).save(dedupKey, at)
  }
}
