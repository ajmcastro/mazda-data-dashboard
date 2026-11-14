// Pure wording of the Fill-ups panel (PLAN.md M47). No React in here.
// A fill-up is a RISE of the fuel level between two status reports: it happened some time between the two,
// and the litres are what the gauge gained (fuel burned in between is not seen, so it understates a little).
// The cost is an estimate; what the owner noted paying is shown next to it and never mixed into it.

import type { Refuel, Refuels } from './api/types'
import { fmtDate, fmtDateTime, fmtNum } from './lib'
import { consumptionLabel, distanceText, fmtConsumption } from './units'

const plural = (n: number, word: string) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`
const money = (v: number, currency: string | null | undefined) => `${fmtNum(v, 2)}${currency ? ` ${currency}` : ''}`

/** When it happened, as far as the data knows: between the two reports. */
export const between = (r: Pick<Refuel, 'before_at' | 'after_at'>): string =>
  `between ${fmtDateTime(r.before_at)} and ${fmtDateTime(r.after_at)}`

/** "30 → 90 %" */
export const levels = (r: Pick<Refuel, 'level_before' | 'level_after'>): string =>
  `${fmtNum(r.level_before)} → ${fmtNum(r.level_after)} %`

/** The litres the gauge gained ("about", because fuel burned between the two reports is not seen), or the points. */
export const amount = (r: Pick<Refuel, 'litres' | 'points'>): string =>
  r.litres === null || r.litres === undefined ? `${fmtNum(r.points)} points` : `about ${fmtNum(r.litres, 1)} l`

/** What was used between the previous fill-up and this one, by the gauge and the odometer. */
export function sincePrevious(r: Refuel): string {
  if (r.km_since_previous === null || r.km_since_previous === undefined) return '—'
  const parts = [distanceText(r.km_since_previous)]
  if (r.l_per_100km_since_previous !== null && r.l_per_100km_since_previous !== undefined) {
    parts.push(`${fmtConsumption(r.l_per_100km_since_previous, 1)} ${consumptionLabel()}`)
  }
  return parts.join(' · ')
}

/** Why a fill-up is marked doubtful. */
export function doubt(r: Refuel, minPoints: number): string | null {
  if (!r.doubtful) return null
  if (r.gap_hours >= 48) return `seen across ${fmtNum(r.gap_hours / 24, 1)} days without a report: more may have gone in`
  return `a rise of ${fmtNum(r.points)} points, under ${fmtNum(minPoints)}: it may not be a fill-up`
}

/** What the owner noted paying for it (several payments around one rise are added up). */
export function paidCell(r: Refuel, currency: string | null | undefined): string {
  if (r.paid === null || r.paid === undefined) return '—'
  const litres = r.paid_litres !== null && r.paid_litres !== undefined ? ` for ${fmtNum(r.paid_litres, 1)} l` : ''
  return `${money(r.paid, currency)}${litres}${r.payments > 1 ? ` (${fmtNum(r.payments)} payments)` : ''}`
}

/** One or two sentences above the table. Estimates and amounts paid are told apart. */
export function summaryLine(d: Refuels | undefined): string | null {
  if (!d) return null
  if (d.fill_ups === 0) return 'No fill-up seen in this period.'
  const said = [`${plural(d.fill_ups, 'fill-up')} in this period`]
  if (d.litres !== null && d.litres !== undefined) said[0] += `: about ${fmtNum(d.litres)} l`
  if (d.est_cost !== null && d.est_cost !== undefined) said[0] += `, an estimated ${money(d.est_cost, d.currency)}`
  said[0] += '.'
  if (d.doubtful > 0) said.push(`${fmtNum(d.doubtful)} of them ${d.doubtful === 1 ? 'is' : 'are'} doubtful.`)
  if (d.paid !== null && d.paid !== undefined) {
    said.push(`You noted paying ${money(d.paid, d.currency)} for ${fmtNum(d.paid_fill_ups)} of them.`)
  }
  return said.join(' ')
}

/** What is missing to show litres and costs, or null when nothing is. */
export function missingSetting(d: Refuels | undefined, modelId: string): string | null {
  if (!d || d.fill_ups === 0) return null
  if (d.tank_litres === null || d.tank_litres === undefined) {
    return `Set tank_litres (the size of the fuel tank) in config/models/${modelId}/settings.yaml to see litres instead of points of the gauge.`
  }
  if (!d.currency) return `Set a fuel price in config/models/${modelId}/settings.yaml to see an estimated cost.`
  return null
}

/** For the Overview: the newest fill-up of the period, in a few words. */
export function lastFillUp(d: Refuels | undefined): string | null {
  const r = d?.refuels.find((x) => !x.doubtful) ?? d?.refuels[0]
  if (!r) return null
  return `last fill-up by ${fmtDate(r.after_at)}${r.litres !== null && r.litres !== undefined ? `, about ${fmtNum(r.litres)} l` : ''}`
}

export const REFUEL_NOTES = [
  'A fill-up is a rise of the fuel level between two status reports: it happened some time between the two.',
  'The litres are what the gauge gained. Fuel burned between the two reports is not seen, so the real amount is a little higher.',
  'The cost is an estimate: the litres times your price for that day. "Paid" is what you noted in fuel_log.yaml, matched by its date.',
] as const
