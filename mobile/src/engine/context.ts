import type { Con } from './db'
import type { DateRange } from './dates'
import type { Query } from './http'

/** What an endpoint handler gets for one request. */
export interface Ctx {
  con: Con
  q: Query
  /** The `from` / `to` period (parsed on first use, so endpoints without a period ignore those parameters). */
  range(): DateRange
  /** Values of `{name}` path segments, decoded. */
  path: Record<string, string>
}

export type Handler = (c: Ctx) => Promise<unknown>
