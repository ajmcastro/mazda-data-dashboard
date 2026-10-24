/** SQL access: what the endpoints need from DuckDB, independent of how it is hosted. */
import type { Table } from 'apache-arrow'
import { tableToRows, type Row } from './convert'

export type { Row }

/** The engine underneath. The browser wraps the async DuckDB-WASM, the tests the blocking Node build. */
export interface RawDb {
  query(sql: string): Promise<Table>
  registerFile(name: string, bytes: Uint8Array): Promise<void>
  dropFile(name: string): Promise<void>
}

/** A naive-UTC timestamp parameter, `YYYY-MM-DD HH:MM:SS[.ffffff]`. */
export class Ts {
  constructor(readonly text: string) {}
}

export type Param = string | number | boolean | null | Ts

function literal(p: Param): string {
  if (p === null) return 'NULL'
  if (p instanceof Ts) return `TIMESTAMP '${p.text}'`
  if (typeof p === 'number') {
    if (!Number.isFinite(p)) throw new Error('non-finite SQL parameter')
    return String(p)
  }
  if (typeof p === 'boolean') return p ? 'true' : 'false'
  return `'${p.replaceAll("'", "''")}'`
}

/** Replaces each `?` outside of quotes by the next parameter, as an SQL literal. */
export function bind(sql: string, params: readonly Param[] = []): string {
  let out = ''
  let next = 0
  let quote: string | null = null
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null
      out += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
    } else if (ch === '?') {
      if (next >= params.length) throw new Error('too few SQL parameters')
      out += literal(params[next++])
    } else out += ch
  }
  if (next !== params.length) throw new Error('too many SQL parameters')
  return out
}

/** The connection the endpoint code uses (same shape as the Python `rows` / `one` helpers). */
export class Con {
  constructor(readonly raw: RawDb) {}

  async rows(sql: string, params: readonly Param[] = []): Promise<Row[]> {
    return tableToRows(await this.raw.query(bind(sql, params)))
  }

  async one(sql: string, params: readonly Param[] = []): Promise<Row> {
    return (await this.rows(sql, params))[0] ?? {}
  }

  async exec(sql: string, params: readonly Param[] = []): Promise<void> {
    await this.raw.query(bind(sql, params))
  }

  async hasTable(name: string): Promise<boolean> {
    return (await this.rows('SELECT 1 FROM duckdb_tables() WHERE table_name = ?', [name])).length > 0
  }
}
