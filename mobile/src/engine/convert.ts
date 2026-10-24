/** Arrow results from DuckDB -> plain JSON values, formatted exactly like the Python API's. */
import { Type } from 'apache-arrow'
import type { Table } from 'apache-arrow'

export type Row = Record<string, unknown>

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** A TIMESTAMP (naive UTC, microseconds) as the API prints it: `2026-06-13T08:45:48Z`, with `.ffffff` only when not zero. */
export function isoTimestamp(ms: number): string {
  const micros = Math.round(ms * 1000)
  const whole = Math.floor(micros / 1_000_000)
  const frac = micros - whole * 1_000_000
  const d = new Date(whole * 1000)
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  return `${date}T${time}${frac ? `.${pad(frac, 6)}` : ''}Z`
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** DECIMAL arrives as 32-bit little-endian words of a two's complement integer. */
function decimal(words: Uint32Array, scale: number): number {
  let n = 0n
  for (let i = words.length - 1; i >= 0; i--) n = (n << 32n) | BigInt(words[i])
  if (words[words.length - 1] & 0x80000000) n -= 1n << BigInt(32 * words.length)
  return Number(n) / 10 ** scale
}

function value(typeId: number, scale: number, v: unknown): unknown {
  if (v === null || v === undefined) return null
  switch (typeId) {
    case Type.Timestamp:
      return isoTimestamp(v as number)
    case Type.Date:
      return isoDate(v as number)
    case Type.Decimal:
      return decimal(v as Uint32Array, scale)
    default:
      return typeof v === 'bigint' ? Number(v) : v
  }
}

export function tableToRows(table: Table): Row[] {
  const fields = table.schema.fields
  const columns = fields.map((f, i) => ({
    name: f.name,
    typeId: f.type.typeId as number,
    scale: (f.type as { scale?: number }).scale ?? 0,
    vector: table.getChildAt(i)!,
  }))
  const out: Row[] = []
  for (let r = 0; r < table.numRows; r++) {
    const row: Row = {}
    for (const c of columns) row[c.name] = value(c.typeId, c.scale, c.vector.get(r))
    out.push(row)
  }
  return out
}
