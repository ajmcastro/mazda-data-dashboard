/** Loads a data pack (`*.cx5pack`, see `backend/src/mazda_dash/pack.py`) into the in-browser database. */
import { unzipSync, strFromU8 } from 'fflate'
import viewsSql from '../../../backend/src/mazda_dash/model/views.sql?raw'
import type { RawDb } from './db'
import { Con } from './db'

export const SUPPORTED_FORMAT = 1

export interface Manifest {
  format: number
  kind: string
  created_at: string
  views_sql_sha256: string
  first_data_day: string
  last_data_day: string
  signals: string[] | 'all'
  tables: Record<string, { rows: number; bytes: number; sha256: string }>
}

export class PackError extends Error {}

/** Every `signal_readings` signal the views read (same rule as `used_signals` in pack.py). */
export function usedSignals(sql: string = viewsSql): string[] {
  return [...new Set([...sql.matchAll(/signal = '([a-z0-9_]+)'/g)].map((m) => m[1]))].sort()
}

async function sha256(data: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null // plain-http pages have no crypto.subtle
  const digest = new Uint8Array(await subtle.digest('SHA-256', data as BufferSource))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Reads and checks the pack's manifest without touching the database. */
export function readPack(bytes: Uint8Array): { manifest: Manifest; files: Record<string, Uint8Array> } {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new PackError('This file is not a data pack (it is not a zip file).')
  }
  if (!files['manifest.json']) throw new PackError('This file is not a data pack (manifest.json is missing).')
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as Manifest
  if (manifest.kind !== 'cx5pack') throw new PackError('This file is not a data pack.')
  if (manifest.format !== SUPPORTED_FORMAT) {
    throw new PackError(
      `This data pack has format ${manifest.format}; this app reads format ${SUPPORTED_FORMAT}. Update the app or export the pack again.`,
    )
  }
  if (manifest.signals !== 'all') {
    const missing = usedSignals().filter((s) => !(manifest.signals as string[]).includes(s))
    if (missing.length) {
      throw new PackError(`This data pack was made by an older version and lacks signals the app needs (${missing.join(', ')}). Export it again.`)
    }
  }
  return { manifest, files }
}

/** Removes every table, view and macro, so a pack can be loaded again (replace / delete data). */
export async function clearDatabase(raw: RawDb): Promise<void> {
  const con = new Con(raw)
  for (const r of await con.rows('SELECT view_name AS n FROM duckdb_views() WHERE NOT internal')) {
    await con.exec(`DROP VIEW IF EXISTS "${r.n}" CASCADE`)
  }
  for (const r of await con.rows('SELECT table_name AS n FROM duckdb_tables()')) {
    await con.exec(`DROP TABLE IF EXISTS "${r.n}" CASCADE`)
  }
  await con.exec('DROP MACRO IF EXISTS hex2int')
}

/** Statements of a SQL script (no `;` inside strings in views.sql), comments removed. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface LoadOptions {
  /** Verify each table's SHA-256 against the manifest (skipped where crypto.subtle is unavailable). */
  verify?: boolean
}

/** Replaces the database content with the pack's: tables from Parquet, then all views. */
export async function loadPack(raw: RawDb, bytes: Uint8Array, options: LoadOptions = {}): Promise<Manifest> {
  const { manifest, files } = readPack(bytes)
  await clearDatabase(raw)
  const con = new Con(raw)
  for (const name of Object.keys(manifest.tables)) {
    const data = files[`tables/${name}.parquet`]
    if (!data) throw new PackError(`The data pack is damaged: table ${name} is missing.`)
    if (options.verify !== false) {
      const hash = await sha256(data)
      if (hash && hash !== manifest.tables[name].sha256) throw new PackError(`The data pack is damaged: table ${name} does not match its checksum.`)
    }
    const file = `pack_${name}.parquet`
    await raw.registerFile(file, data)
    await con.exec(`CREATE TABLE "${name}" AS SELECT * FROM read_parquet('${file}')`)
    await raw.dropFile(file)
  }
  for (const st of statements(viewsSql)) await con.exec(st)
  return manifest
}
