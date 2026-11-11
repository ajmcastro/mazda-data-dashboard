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

type Fuel = Pick<Garage, 'fuel_l_30d' | 'l_per_100km_30d' | 'fuel_cost_30d' | 'cost_per_100km_30d' | 'currency'>
export type Block = { value: string; sub: string }

/** Fuel used in the 30 days: the litres and the average consumption, both estimates (null without consumption).
 * The unit is a capital L: in the display font a small l looks like an I. */
export function fuelBlock(g: Fuel): Block | null {
  if (g.fuel_l_30d == null || g.l_per_100km_30d == null) return null
  return { value: `${fmtNum(g.fuel_l_30d)} L`, sub: `${fmtNum(g.l_per_100km_30d, 2)} l/100 km on average (estimated)` }
}

/** The estimated cost of that fuel: the total and the average per 100 km, in the car's own currency (null without a fuel price). */
export function costBlock(g: Fuel): Block | null {
  if (g.fuel_cost_30d == null || g.cost_per_100km_30d == null || !g.currency) return null
  return { value: `${fmtNum(g.fuel_cost_30d)} ${g.currency}`, sub: `${fmtNum(g.cost_per_100km_30d, 2)} ${g.currency} per 100 km (estimated)` }
}

/** The caution under the page title: the totals are estimates, and averages between two cars need care. */
export const FUEL_CAUTION =
  'Fuel and cost are estimates: the distance times the average consumption, and times the fuel price you entered, not what you paid. ' +
  "Averages between two cars need care (a plug-in hybrid's l/100 km hides the electric part)."

/** The text of a model selector entry: the name, with the new alerts when there are some. */
export function optionLabel(name: string, newAlerts: number | undefined, hasData = true): string {
  const suffix = hasData ? '' : ' (no data yet)'
  // short on purpose: the selector is a narrow box and a long entry gets cut off
  return newAlerts ? `${name} · ${newAlerts} alert${newAlerts === 1 ? '' : 's'}${suffix}` : `${name}${suffix}`
}
