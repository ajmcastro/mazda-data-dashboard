/** DuckDB-WASM in the browser (a Web Worker), wrapped as the `RawDb` the engine uses. */
import * as duckdb from '@duckdb/duckdb-wasm'
import worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import wasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import type { RawDb } from './engine/db'

/** Only the "exception handling" build is shipped (every iOS since 15.2, current Chrome / Firefox). */
export async function startBrowserEngine(): Promise<RawDb> {
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(worker))
  await db.instantiate(wasm)
  const conn = await db.connect()
  // One query at a time: pages fire many requests together and a pack load must not interleave.
  let tail: Promise<unknown> = Promise.resolve()
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job)
    tail = run.catch(() => undefined)
    return run
  }
  return {
    query: (sql) => serial(() => conn.query(sql)),
    registerFile: (name, bytes) => serial(() => db.registerFileBuffer(name, bytes)),
    dropFile: (name) => serial(async () => void (await db.dropFile(name))),
  }
}
