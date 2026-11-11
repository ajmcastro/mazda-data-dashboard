// Pure wording of the "All cars" page: how old a car's data is, the oil line, the alert counts. No React in here.

import type { Garage } from './api/types'
import { fmtAgo, fmtNum } from './lib'

/** A car whose newest reading is older than this is flagged: its figures may be out of date. */
export const STALE_AFTER_DAYS = 7

export function dataAgeDays(lastReadingAt: string | null | undefined, now = Date.now()): number | null {
  if (!lastReadingAt) return null
  return Math.max(0, Math.floor((now - new Date(lastReadingAt).getTime()) / 86_400_000))
}

/** "last reading 12 days ago: the figures may be out of date", or null while the data is recent. */
export function staleNote(lastReadingAt: string | null | undefined, now = Date.now()): string | null {
  const days = dataAgeDays(lastReadingAt, now)
  if (days === null || days <= STALE_AFTER_DAYS) return null
  return `last reading ${fmtAgo(lastReadingAt, now)}: the figures may be out of date`
}

export function alertsLabel(n: number): string {
  return n === 0 ? 'no new alerts' : `${n} new alert${n === 1 ? '' : 's'}`
}

export function faultsLabel(n: number): string {
  return n === 0 ? 'no faults listed' : `${n} fault${n === 1 ? '' : 's'} listed`
}

/** The car's own countdown, as it reports it (not a calculation). */
export function oilLine(g: Pick<Garage, 'oil_remaining_km'>): string {
  return g.oil_remaining_km === null || g.oil_remaining_km === undefined ? 'not reported' : `${fmtNum(g.oil_remaining_km)} km left`
}

/** The text of a model selector entry: the name, with the new alerts when there are some. */
export function optionLabel(name: string, newAlerts: number | undefined, hasData = true): string {
  const suffix = hasData ? '' : ' (no data yet)'
  // short on purpose: the selector is a narrow box and a long entry gets cut off
  return newAlerts ? `${name} · ${newAlerts} alert${newAlerts === 1 ? '' : 's'}${suffix}` : `${name}${suffix}`
}
