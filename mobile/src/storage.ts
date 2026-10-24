/** What the phone keeps between launches: the data pack and the acknowledgements made on the phone (IndexedDB). */
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
const PACK = 'pack'
const ACKS = 'acks'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PACK)
      req.result.createObjectStore(ACKS)
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

export async function readStoredPack(): Promise<StoredPack | null> {
  return ((await tx([PACK], 'readonly', (t) => t.objectStore(PACK).get('current'))) as StoredPack | undefined) ?? null
}

export async function writeStoredPack(pack: StoredPack): Promise<void> {
  await tx([PACK], 'readwrite', (t) => void t.objectStore(PACK).put(pack, 'current'))
}

/** Removes the pack and the acknowledgements that belong to it. */
export async function deleteStoredData(): Promise<void> {
  await tx([PACK, ACKS], 'readwrite', (t) => {
    t.objectStore(PACK).clear()
    t.objectStore(ACKS).clear()
  })
}

export class IdbAckStore implements AckStore {
  async load(): Promise<Record<string, string>> {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const out: Record<string, string> = {}
        const req = db.transaction([ACKS], 'readonly').objectStore(ACKS).openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) return resolve(out)
          out[String(cursor.key)] = cursor.value as string
          cursor.continue()
        }
        req.onerror = () => reject(req.error)
      })
    } finally {
      db.close()
    }
  }

  async save(dedupKey: string, at: string): Promise<void> {
    await tx([ACKS], 'readwrite', (t) => void t.objectStore(ACKS).put(at, dedupKey))
  }
}
