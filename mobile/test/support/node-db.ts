/** DuckDB-WASM in Node (the blocking build), wrapped as the async `RawDb` the engine uses. Same engine as the phone. */
import { createRequire } from 'node:module'
import path from 'node:path'
import type { RawDb } from '../../src/engine/db'

const require = createRequire(import.meta.url)

export async function nodeDb(): Promise<RawDb> {
  const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs')
  const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'))
  const bundles = {
    mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: '' },
    eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: '' },
  }
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME)
  await db.instantiate(() => {})
  db.open({})
  const conn = db.connect()
  return {
    query: async (sql) => conn.query(sql),
    registerFile: async (name, bytes) => void db.registerFileBuffer(name, bytes),
    dropFile: async (name) => void db.dropFile(name),
  }
}
