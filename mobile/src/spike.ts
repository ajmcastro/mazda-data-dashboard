// M12 feasibility spike (throwaway code, not the real app). Question it answers: can DuckDB-WASM
// load a data pack and rebuild all the SQL views, with the same results as Python, fast enough on a
// phone? Everything is measured and posted to the dev server (see resultsSink in vite.config.ts).

import * as duckdb from '@duckdb/duckdb-wasm'
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import wasm_mvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import { unzipSync } from 'fflate'
import viewsSql from '../../backend/src/mazda_dash/model/views.sql?raw'

type Json = string | number | boolean | null
type Reference = {
  views: Record<string, { sql: string; expected: Record<string, Json> }>
  tables: Record<string, number>
}

const params = new URLSearchParams(location.search)
const label = params.get('label') ?? 'browser'
const $ = (id: string) => document.getElementById(id)!
const logEl = $('log')
const log = (m: string) => {
  logEl.textContent += `${m}\n`
  console.log(m)
}
const ms = (t0: number) => Math.round(performance.now() - t0)
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** BigInt (64-bit ints) and Arrow decimals to plain numbers, for comparing and for JSON. */
function plain(v: unknown): Json {
  if (typeof v === 'bigint') return Number(v)
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  return Number(v as number)
}

async function rows(conn: duckdb.AsyncDuckDBConnection, sql: string): Promise<Record<string, Json>[]> {
  const table = await conn.query(sql)
  const names = table.schema.fields.map((f) => f.name)
  return table.toArray().map((r) => {
    const o: Record<string, Json> = {}
    const json = r.toJSON() as Record<string, unknown>
    for (const n of names) o[n] = plain(json[n])
    return o
  })
}

function close(a: Json, b: Json): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 + 1e-9 * Math.abs(b)
  return a === b
}

/** Statements of views.sql one by one (used only if running the whole script at once fails). */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const QUERIES: Record<string, string> = {
  warning_frequency: 'SELECT * FROM v_warning_frequency',
  dtc_frequency: 'SELECT * FROM v_dtc_frequency',
  vehicle_status: 'SELECT * FROM v_vehicle_status ORDER BY created_at',
  trip_segments: 'SELECT * FROM v_trip_segments ORDER BY end_at DESC LIMIT 500',
  odometer_daily: 'SELECT * FROM v_odometer_daily ORDER BY day',
  warnings_daily:
    'SELECT CAST(triggered_at AS DATE) AS day, code, count(*) AS events FROM v_warnings WHERE triggered_at IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2',
  fuel_monthly_in_range:
    "SELECT strftime(date_trunc('month', end_at), '%Y-%m') AS month, count(*) AS segments, round(sum(km), 1) AS km, round(100 * sum(fuel_l) / nullif(sum(km), 0), 2) AS l_per_100km FROM v_trip_segments WHERE end_at >= TIMESTAMP '2026-03-01' GROUP BY 1 ORDER BY month",
  dtc_frequency_with_state:
    'SELECT e.ecu, e.dtc_code, count(DISTINCT e.transaction_id) AS readouts, bool_or(e.transaction_id = (SELECT transaction_id FROM dtc_headers ORDER BY copied_at DESC LIMIT 1)) AS active FROM v_dtc_events e GROUP BY e.ecu, e.dtc_code, e.failure_type',
}

type Engine = {
  db: duckdb.AsyncDuckDB
  conn: duckdb.AsyncDuckDBConnection
  worker: Worker
  bundle: string
}

/** Starts DuckDB-WASM. With diag, first times the engine download and a standalone compile. */
async function startEngine(out: Record<string, unknown>, diag: boolean): Promise<Engine> {
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: wasm_mvp, mainWorker: mvp_worker },
    eh: { mainModule: wasm_eh, mainWorker: eh_worker },
  })
  if (diag) {
    let t = performance.now()
    const buf = await (await fetch(bundle.mainModule)).arrayBuffer()
    out.wasmDownloadMs = ms(t)
    out.wasmBytes = buf.byteLength
    t = performance.now()
    await WebAssembly.compile(buf)
    out.wasmCompileMs = ms(t)
  }
  const t0 = performance.now()
  const worker = new Worker(bundle.mainWorker!)
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  out.initMs = ms(t0) // download (browser cache after diag) + compile + start
  const conn = await db.connect()
  out.bundle = bundle.mainModule.includes('-eh') ? 'eh' : 'mvp'
  out.duckdbVersion = (await rows(conn, 'SELECT version() AS v'))[0].v
  return { db, conn, worker, bundle: String(out.bundle) }
}

async function stopEngine(e: Engine) {
  await e.conn.close()
  await e.db.terminate()
  e.worker.terminate()
}

/** Tables from the pack's Parquet files, then every view of views.sql. */
async function loadPack(e: Engine, files: Record<string, Uint8Array>, tag = '') {
  let t0 = performance.now()
  let tableRows = 0
  const tables: string[] = []
  for (const [path, data] of Object.entries(files)) {
    const m = path.match(/^tables\/(.+)\.parquet$/)
    if (!m) continue
    const file = `${tag}${m[1]}.parquet`
    await e.db.registerFileBuffer(file, data)
    await e.conn.query(`CREATE TABLE ${m[1]} AS SELECT * FROM read_parquet('${file}')`)
    await e.db.dropFile(file)
    tables.push(m[1])
    tableRows += Number((await rows(e.conn, `SELECT count(*) AS n FROM ${m[1]}`))[0].n)
  }
  const tablesMs = ms(t0)
  t0 = performance.now()
  let viewsMode = 'one script'
  try {
    await e.conn.query(viewsSql)
  } catch (err) {
    log(`whole script failed (${(err as Error).message.slice(0, 120)}); running statement by statement`)
    viewsMode = 'statement by statement'
    for (const st of statements(viewsSql)) await e.conn.query(st)
  }
  return { tablesMs, viewsMs: ms(t0), tableRows, viewsMode, tables }
}

/** Removes everything loadPack created, so another pack can be loaded into the same engine. */
async function clearAll(e: Engine) {
  const views = (await rows(e.conn, 'SELECT view_name AS n FROM duckdb_views() WHERE NOT internal')).map((r) => String(r.n))
  for (const v of views) await e.conn.query(`DROP VIEW IF EXISTS ${v} CASCADE`)
  const tables = (await rows(e.conn, 'SELECT table_name AS n FROM duckdb_tables()')).map((r) => String(r.n))
  for (const t of tables) await e.conn.query(`DROP TABLE IF EXISTS ${t} CASCADE`)
  await e.conn.query('DROP MACRO IF EXISTS hex2int')
}

/** Raw speed of the device: plain JavaScript and two scans inside DuckDB. */
async function cpuBench(e: Engine) {
  let t = performance.now()
  let x = 0
  for (let i = 0; i < 30_000_000; i++) x += i % 7
  const jsLoopMs = ms(t)
  t = performance.now()
  await rows(e.conn, 'SELECT sum(i * i)::DOUBLE AS s FROM range(20000000) t(i)')
  const duckSumMs = ms(t)
  t = performance.now()
  await rows(e.conn, 'SELECT count(DISTINCT i % 5000) AS n FROM range(5000000) t(i)')
  return { jsLoopMs, duckSumMs, duckDistinctMs: ms(t), jsCheck: x > 0 }
}

async function timeQueries(e: Engine, runsEach = 6) {
  const timings: Record<string, { firstMs: number; medianMs: number; rows: number }> = {}
  for (const [name, sql] of Object.entries(QUERIES)) {
    const runs: number[] = []
    let n = 0
    for (let i = 0; i < runsEach; i++) {
      const t = performance.now()
      n = (await rows(e.conn, sql)).length
      runs.push(performance.now() - t)
    }
    timings[name] = { firstMs: Math.round(runs[0] * 10) / 10, medianMs: Math.round(median(runs.slice(1)) * 10) / 10, rows: n }
  }
  return timings
}

async function run(packBytes: Uint8Array, source: 'demo' | 'own', referenceUrl: string | null, packName = '') {
  const out: Record<string, unknown> = {
    label,
    mode: 'run',
    source,
    packName,
    userAgent: navigator.userAgent,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    packBytes: packBytes.length,
  }
  const t00 = performance.now()
  $('verdict').textContent = 'Running…'
  logEl.textContent = ''

  let t0 = performance.now()
  const files = unzipSync(packBytes)
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
  out.unzipMs = ms(t0)
  out.packFormat = manifest.format
  const hash = await sha256(viewsSql)
  out.viewsSqlMatchesPack = hash && manifest.views_sql_sha256 ? hash === manifest.views_sql_sha256 : null
  out.packSignals = manifest.signals === 'all' ? 'all' : (manifest.signals?.length ?? null)
  log(`unzipped ${Object.keys(files).length} files in ${out.unzipMs} ms`)

  const engine = await startEngine(out, true)
  log(`DuckDB ${out.duckdbVersion}: download ${out.wasmDownloadMs} ms, compile ${out.wasmCompileMs} ms, start ${out.initMs} ms`)
  const loaded = await loadPack(engine, files)
  Object.assign(out, loaded)
  out.coldStartMs = ms(t00) // unzip + engine + tables + views: what the app would wait for
  log(`${loaded.tableRows.toLocaleString()} rows in ${loaded.tablesMs} ms; views ${loaded.viewsMs} ms; cold start ${out.coldStartMs} ms`)

  const problems: string[] = []
  let viewsChecked = 0
  const conn = engine.conn
  if (referenceUrl) {
    t0 = performance.now()
    const ref: Reference = await (await fetch(referenceUrl)).json()
    for (const [view, entry] of Object.entries(ref.views)) {
      try {
        const got = (await rows(conn, entry.sql))[0]
        viewsChecked++
        for (const [k, want] of Object.entries(entry.expected)) {
          if (!close(got[k] ?? null, want)) problems.push(source === 'demo' ? `${view}.${k}: got ${got[k]} want ${want}` : `${view}.${k} differs`)
        }
      } catch (e) {
        problems.push(`${view}: ${(e as Error).message.slice(0, 100)}`)
      }
    }
    for (const [table, n] of Object.entries(ref.tables)) {
      const got = Number((await rows(conn, `SELECT count(*) AS n FROM ${table}`))[0].n)
      if (got !== n) problems.push(`table ${table}: ${got} rows, expected ${n}`)
    }
    out.fingerprintMs = ms(t0)
  } else {
    const views = (await rows(conn, "SELECT view_name FROM duckdb_views() WHERE NOT internal AND view_name LIKE 'v\\_%' ESCAPE '\\' ORDER BY 1")).map((r) => String(r.view_name))
    for (const v of views) {
      try {
        await rows(conn, `SELECT count(*) FROM ${v}`)
        viewsChecked++
      } catch (e) {
        problems.push(`${v}: ${(e as Error).message.slice(0, 100)}`)
      }
    }
  }
  out.viewsChecked = viewsChecked
  out.compared = Boolean(referenceUrl)
  out.problems = problems
  log(`${viewsChecked} views ${referenceUrl ? 'compared' : 'run (no reference for this pack)'}; ${problems.length} problem(s)`)
  problems.slice(0, 8).forEach((p) => log(`  ✗ ${p}`))

  out.queries = await timeQueries(engine)
  out.cpu = await cpuBench(engine)
  out.readyToFirstScreenMs = ms(t00)

  out.duckdbMemory = (await rows(conn, 'SELECT tag, memory_usage_bytes AS bytes FROM duckdb_memory() WHERE memory_usage_bytes > 0')).map((r) => `${r.tag}=${r.bytes}`)
  const perf = performance as unknown as { memory?: { usedJSHeapSize: number } }
  out.jsHeapMB = perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null
  out.storage = await storageTest(packBytes)
  await stopEngine(engine)
  return out
}

/** Several packs one after the other in the same engine: what does each cost to load? */
async function runVariants(list: { name: string; arrayBuffer: () => Promise<ArrayBuffer> }[]) {
  const out: Record<string, unknown> = { label, mode: 'variants', userAgent: navigator.userAgent, screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, hardwareConcurrency: navigator.hardwareConcurrency }
  $('verdict').textContent = 'Comparing packs…'
  logEl.textContent = ''
  const engine = await startEngine(out, true)
  out.cpu = await cpuBench(engine)
  const loaded = await Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
  loaded.sort((a, b) => a.name.localeCompare(b.name))
  const order = [...loaded, ...[...loaded].reverse()] // twice, second pass reversed, to expose order and warm-up effects
  const results: Record<string, unknown>[] = []
  for (const [i, pack] of order.entries()) {
    const files = unzipSync(pack.bytes)
    await clearAll(engine)
    const res = await loadPack(engine, files, `v${i}_`)
    let t = performance.now()
    for (const sql of Object.values(QUERIES)) await rows(engine.conn, sql)
    const queriesOnePassMs = ms(t)
    t = performance.now()
    await timeQueries(engine, 3)
    results.push({ pass: i < loaded.length ? 1 : 2, name: pack.name, KiB: Math.round(pack.bytes.length / 1024), rows: res.tableRows, tablesMs: res.tablesMs, viewsMs: res.viewsMs, queriesOnePassMs })
    log(`${pack.name}: tables ${res.tablesMs} ms, views ${res.viewsMs} ms, 8 queries ${queriesOnePassMs} ms`)
  }
  out.variants = results
  out.problems = []
  await stopEngine(engine)
  return out
}

/** Can the pack live on the device? IndexedDB round trip plus what the browser says about quota. */
async function storageTest(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  try {
    const est = await navigator.storage?.estimate?.()
    out.quotaMB = est?.quota ? Math.round(est.quota / 1048576) : null
    out.persistGranted = (await navigator.storage?.persist?.()) ?? null
    const t = performance.now()
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('cx5-spike', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('packs')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const tx = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        const req = f(idb.transaction('packs', mode).objectStore('packs'))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    await tx('readwrite', (s) => s.put(bytes, 'current'))
    const back = await tx<Uint8Array>('readonly', (s) => s.get('current'))
    out.idbRoundTripMs = ms(t)
    out.idbIntact = back.byteLength === bytes.length && back[0] === bytes[0] && back[back.length - 1] === bytes[bytes.length - 1]
    await tx('readwrite', (s) => s.delete('current'))
    idb.close()
  } catch (e) {
    out.error = String(e)
  }
  return out
}

async function sha256(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function table(rowsOfCells: (string | number)[][], header?: string[]): string {
  const head = header ? `<tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr>` : ''
  return `<table>${head}${rowsOfCells.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`
}

function show(out: Record<string, unknown>) {
  const problems = out.problems as string[]
  const verdict = $('verdict')
  const good = problems.length === 0
  verdict.className = good ? 'ok' : 'bad'
  if (out.mode === 'variants') {
    verdict.textContent = '✓ pack comparison done'
    const cpu = out.cpu as Record<string, number>
    const v = out.variants as { pass: number; name: string; KiB: number; rows: number; tablesMs: number; viewsMs: number; queriesOnePassMs: number }[]
    $('summary').innerHTML =
      table(v.map((x) => [x.pass, x.name, x.KiB, x.rows.toLocaleString(), x.tablesMs, x.viewsMs, x.queriesOnePassMs]), ['pass', 'pack', 'KiB', 'rows', 'tables ms', 'views ms', '8 queries ms']) +
      table([['engine download', `${out.wasmDownloadMs} ms`], ['engine compile', `${out.wasmCompileMs} ms`], ['engine start', `${out.initMs} ms`], ['JS loop 30M', `${cpu.jsLoopMs} ms`], ['DuckDB sum 20M rows', `${cpu.duckSumMs} ms`], ['DuckDB distinct 5M rows', `${cpu.duckDistinctMs} ms`]])
    return
  }
  verdict.textContent = good
    ? `✓ ${out.viewsChecked} views ${out.compared ? 'identical to Python' : 'built (no reference)'} · cold start ${out.coldStartMs} ms`
    : `✗ ${problems.length} problem(s), see log`
  const q = out.queries as Record<string, { firstMs: number; medianMs: number; rows: number }>
  const cpu = out.cpu as Record<string, number>
  const st = out.storage as Record<string, unknown>
  $('summary').innerHTML = table([
    ['engine', `DuckDB ${out.duckdbVersion} (${out.bundle})`],
    ['pack', `${out.packName || out.source} · ${Math.round((out.packBytes as number) / 1024)} KiB, ${(out.tableRows as number).toLocaleString()} rows, signals ${out.packSignals}`],
    ['engine download', `${out.wasmDownloadMs} ms (${Math.round((out.wasmBytes as number) / 1048576)} MB)`],
    ['engine compile', `${out.wasmCompileMs} ms`],
    ['engine start', `${out.initMs} ms`],
    ['load tables', `${out.tablesMs} ms`],
    ['rebuild views', `${out.viewsMs} ms (${out.viewsMode})`],
    ['COLD START (unzip+engine+tables+views)', `<b>${out.coldStartMs} ms</b>`],
    ['JS loop 30M / DuckDB sum 20M / distinct 5M', `${cpu.jsLoopMs} / ${cpu.duckSumMs} / ${cpu.duckDistinctMs} ms`],
    ['storage', `IndexedDB ${st.idbRoundTripMs} ms, intact ${st.idbIntact}, quota ${st.quotaMB} MB, persistent ${st.persistGranted}`],
    ['JS heap', out.jsHeapMB === null ? 'n/a in this browser' : `${out.jsHeapMB} MB`],
    ...Object.entries(q).map(([k, v]) => [k, `first ${v.firstMs} ms · typical ${v.medianMs} ms · ${v.rows} rows`]),
  ])
}

async function finish(out: Record<string, unknown>) {
  show(out)
  ;(window as unknown as { __spike: unknown }).__spike = out
  try {
    await fetch(`/__results?label=${encodeURIComponent(label)}`, { method: 'POST', body: JSON.stringify(out, null, 1) })
    log('results sent to the dev server')
  } catch {
    log('could not send results to the dev server (copy them from the table above)')
  }
}

async function runDemo() {
  // ?pack=/real.cx5pack runs a pack served from public/ (a local, gitignored copy of your own data)
  const packUrl = params.get('pack') ?? '/demo.cx5pack'
  const source = packUrl === '/demo.cx5pack' ? 'demo' : 'own'
  const t = performance.now()
  const bytes = new Uint8Array(await (await fetch(packUrl)).arrayBuffer())
  log(`pack downloaded in ${ms(t)} ms`)
  const ref = (await fetch(`${packUrl}.reference.json`, { method: 'HEAD' })).ok ? `${packUrl}.reference.json` : null
  await finish({ ...(await run(bytes, source, ref, packUrl.split('/').pop())), packFetchMs: ms(t) })
}

const fileBytes = async (f: File) => new Uint8Array(await f.arrayBuffer())
$('run-demo').addEventListener('click', () => void runDemo().catch(fail))
$('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void fileBytes(f).then((b) => run(b, 'own', null, f.name)).then(finish).catch(fail)
})
$('files').addEventListener('change', (e) => {
  const list = [...((e.target as HTMLInputElement).files ?? [])]
  if (list.length) void runVariants(list).then(finish).catch(fail)
})
function fail(e: unknown) {
  $('verdict').className = 'bad'
  $('verdict').textContent = `✗ failed: ${(e as Error).message}`
  log(String((e as Error).stack ?? e))
  void fetch(`/__results?label=${encodeURIComponent(label)}-failed`, { method: 'POST', body: JSON.stringify({ label, error: String((e as Error).stack ?? e) }) }).catch(() => undefined)
}
// ?autorun=1 alone: the normal run.
// ?autorun=1&variants=/demo.cx5pack,/demo.cx5pack: pack comparison from served (demo) packs.
async function auto() {
  const fetchBytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer())
  if (params.get('variants')) {
    const urls = params.get('variants')!.split(',')
    const list = urls.map((u, i) => ({ name: `${i}-${u.split('/').pop()}`, arrayBuffer: async () => (await fetchBytes(u)).buffer as ArrayBuffer }))
    return finish(await runVariants(list))
  }
  return runDemo()
}
if (params.get('autorun')) void auto().catch(fail)
