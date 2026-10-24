/** The `from` / `to` period shared by the period endpoints (port of `api/dates.py`). Days are UTC and inclusive. */
import { HttpError, invalid, type Query } from './http'
import { Ts, type Param } from './db'

export const DAY_MS = 86_400_000

/** Strict `YYYY-MM-DD` that is a real calendar day. */
export function parseDay(name: string, text: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    if (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) return text
  }
  throw invalid(name, 'Input should be a valid date or datetime, invalid character in year')
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

export class DateRange {
  constructor(
    readonly start?: string,
    readonly end?: string, // inclusive
  ) {}

  get startTs(): Ts | undefined {
    return this.start ? new Ts(`${this.start} 00:00:00`) : undefined
  }

  /** Exclusive upper bound: midnight after the last included day. */
  get endTs(): Ts | undefined {
    return this.end ? new Ts(`${addDays(this.end, 1)} 00:00:00`) : undefined
  }

  conds(col: string): { conds: string[]; params: Param[] } {
    const conds: string[] = []
    const params: Param[] = []
    if (this.startTs) {
      conds.push(`${col} >= ?`)
      params.push(this.startTs)
    }
    if (this.endTs) {
      conds.push(`${col} < ?`)
      params.push(this.endTs)
    }
    return { conds, params }
  }

  /** SQL fragment limiting `col` to the range ('' when open). */
  clause(col: string, prefix = 'WHERE'): { sql: string; params: Param[] } {
    const { conds, params } = this.conds(col)
    return conds.length ? { sql: `${prefix} ${conds.join(' AND ')}`, params } : { sql: '', params: [] }
  }
}

export function dateRange(q: Query): DateRange {
  const from = q.str('from')
  const to = q.str('to')
  const start = from === undefined ? undefined : parseDay('from', from)
  const end = to === undefined ? undefined : parseDay('to', to)
  if (start && end && start > end) throw new HttpError(422, "'from' must not be after 'to'")
  return new DateRange(start, end)
}
