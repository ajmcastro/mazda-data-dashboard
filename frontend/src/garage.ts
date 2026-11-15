// Pure wording of the "All cars" page: how old a car's data is, the oil line, the alert counts. No React in here.

import { msg, tr, trn } from './i18n'
import type { Garage } from './api/types'
import { fmtAgo, fmtNum } from './lib'
import { consumptionLabel, distanceText, fmtConsumption, per100Label, toPer100 } from './units'

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
  return tr('last reading {ago}: the figures may be out of date', { ago: fmtAgo(lastReadingAt, now) })
}

export function alertsLabel(n: number): string {
  return n === 0 ? tr('no new alerts') : trn('{n} new alert', '{n} new alerts', n)
}

export function faultsLabel(n: number): string {
  return n === 0 ? tr('no faults listed') : trn('{n} fault listed', '{n} faults listed', n)
}

/** The car's own countdown, as it reports it (not a calculation). */
export function oilLine(g: Pick<Garage, 'oil_remaining_km'>): string {
  return g.oil_remaining_km === null || g.oil_remaining_km === undefined ? tr('not reported') : tr('{distance} left', { distance: distanceText(g.oil_remaining_km) })
}

type Fuel = Pick<Garage, 'fuel_l_30d' | 'l_per_100km_30d' | 'fuel_cost_30d' | 'cost_per_100km_30d' | 'currency'>
export type Block = { value: string; sub: string }

/** Fuel used in the 30 days: the litres and the average consumption, both estimates (null without consumption).
 * The unit is a capital L: in the display font a small l looks like an I. */
export function fuelBlock(g: Fuel): Block | null {
  if (g.fuel_l_30d == null || g.l_per_100km_30d == null) return null
  return { value: `${fmtNum(g.fuel_l_30d)} L`, sub: tr('{rate} {unit} on average (estimated)', { rate: fmtConsumption(g.l_per_100km_30d, 2), unit: consumptionLabel() }) }
}

/** The estimated cost of that fuel: the total and the average per 100 km, in the car's own currency (null without a fuel price). */
export function costBlock(g: Fuel): Block | null {
  if (g.fuel_cost_30d == null || g.cost_per_100km_30d == null || !g.currency) return null
  return { value: `${fmtNum(g.fuel_cost_30d)} ${g.currency}`, sub: tr('{cost} {currency} per {per} (estimated)', { cost: fmtNum(toPer100(g.cost_per_100km_30d), 2), currency: g.currency, per: per100Label() }) }
}

/** The caution under the page title: the totals are estimates, and averages between two cars need care. */
export const FUEL_CAUTION =
  msg("Fuel and cost are estimates: the distance times the average consumption, and times the fuel price you entered, not what you paid. Averages between two cars need care (a plug-in hybrid's fuel consumption hides the electric part).")

/** The text of a model selector entry: the name, with the new alerts when there are some. */
export function optionLabel(name: string, newAlerts: number | undefined, hasData = true): string {
  const suffix = hasData ? '' : ` (${tr('no data yet')})`
  // short on purpose: the selector is a narrow box and a long entry gets cut off
  return newAlerts ? `${name} · ${trn('{n} alert', '{n} alerts', newAlerts)}${suffix}` : `${name}${suffix}`
}
