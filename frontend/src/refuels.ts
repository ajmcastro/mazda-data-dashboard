// Pure wording of the Fill-ups panel (PLAN.md M47). No React in here.
// A fill-up is a RISE of the fuel level between two status reports: it happened some time between the two,
// and the litres are what the gauge gained (fuel burned in between is not seen, so it understates a little).
// The cost is an estimate; what the owner noted paying is shown next to it and never mixed into it.

import { msg, tr, trn } from './i18n'
import type { Refuel, Refuels } from './api/types'
import { fmtDate, fmtDateTime, fmtNum } from './lib'
import { consumptionLabel, distanceText, fmtConsumption } from './units'

const money = (v: number, currency: string | null | undefined) => `${fmtNum(v, 2)}${currency ? ` ${currency}` : ''}`

/** When it happened, as far as the data knows: between the two reports. */
export const between = (r: Pick<Refuel, 'before_at' | 'after_at'>): string =>
  tr('between {a} and {b}', { a: fmtDateTime(r.before_at), b: fmtDateTime(r.after_at) })

/** "30 → 90 %" */
export const levels = (r: Pick<Refuel, 'level_before' | 'level_after'>): string =>
  `${fmtNum(r.level_before)} → ${fmtNum(r.level_after)} %`

/** The litres the gauge gained ("about", because fuel burned between the two reports is not seen), or the points. */
export const amount = (r: Pick<Refuel, 'litres' | 'points'>): string =>
  r.litres === null || r.litres === undefined ? tr('{n} points', { n: fmtNum(r.points) }) : tr('about {n} l', { n: fmtNum(r.litres, 1) })

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
  if (r.gap_hours >= 48) return tr('seen across {n} days without a report: more may have gone in', { n: fmtNum(r.gap_hours / 24, 1) })
  return tr('a rise of {n} points, under {min}: it may not be a fill-up', { n: fmtNum(r.points), min: fmtNum(minPoints) })
}

/** What the owner noted paying for it (several payments around one rise are added up). */
export function paidCell(r: Refuel, currency: string | null | undefined): string {
  if (r.paid === null || r.paid === undefined) return '—'
  const litres = r.paid_litres !== null && r.paid_litres !== undefined ? ` ${tr('for {n} l', { n: fmtNum(r.paid_litres, 1) })}` : ''
  const match = r.confidence && r.confidence !== 'high' ? ` · ${tr(CONFIDENCE[r.confidence] ?? r.confidence)}` : ''
  return `${money(r.paid, currency)}${litres}${r.payments > 1 ? ` (${tr('{n} payments', { n: fmtNum(r.payments) })})` : ''}${match}`
}

const CONFIDENCE: Record<string, string> = { medium: msg('likely match'), low: msg('uncertain match') }

/**
 * Why a payment's match is not certain (M70), for the line under the table, or null for a match on the right days
 * with litres that agree (or none noted).
 */
export function matchLine(r: Refuel): string | null {
  if (!r.confidence || r.confidence === 'high') return null
  const why: string[] = []
  if (r.days_off) why.push(trn('noted {n} day from the two reports', 'noted {n} days from the two reports', r.days_off, { n: r.days_off }))
  if (r.litres_differ) why.push(tr('the litres you noted and the litres the gauge gained differ'))
  return `${fmtDate(r.after_at)}: ${tr(CONFIDENCE[r.confidence] ?? r.confidence)}${why.length ? ` (${why.join('; ')})` : ''}.`
}

/** One or two sentences above the table. Estimates and amounts paid are told apart. */
export function summaryLine(d: Refuels | undefined): string | null {
  if (!d) return null
  if (d.fill_ups === 0) return tr('No fill-up seen in this period.')
  const said = [trn('{n} fill-up in this period', '{n} fill-ups in this period', d.fill_ups, { n: fmtNum(d.fill_ups) })]
  if (d.litres !== null && d.litres !== undefined) said[0] += `: ${tr('about {n} l', { n: fmtNum(d.litres) })}`
  if (d.est_cost !== null && d.est_cost !== undefined) said[0] += `, ${tr('an estimated {amount}', { amount: money(d.est_cost, d.currency) })}`
  said[0] += '.'
  if (d.doubtful > 0) said.push(trn('{n} of them is doubtful.', '{n} of them are doubtful.', d.doubtful, { n: fmtNum(d.doubtful) }))
  if (d.paid !== null && d.paid !== undefined) {
    said.push(tr('You noted paying {amount} for {n} of them.', { amount: money(d.paid, d.currency), n: fmtNum(d.paid_fill_ups) }))
  }
  return said.join(' ')
}

/** What is missing to show litres and costs, or null when nothing is. */
export function missingSetting(d: Refuels | undefined, modelId: string): string | null {
  if (!d || d.fill_ups === 0) return null
  if (d.tank_litres === null || d.tank_litres === undefined) {
    return tr('Set tank_litres (the size of the fuel tank) in config/models/{model}/settings.yaml to see litres instead of points of the gauge.', { model: modelId })
  }
  if (!d.currency) return tr('Set a fuel price in config/models/{model}/settings.yaml to see an estimated cost.', { model: modelId })
  return null
}

/** For the Overview: the newest fill-up of the period, in a few words. */
export function lastFillUp(d: Refuels | undefined): string | null {
  const r = d?.refuels.find((x) => !x.doubtful) ?? d?.refuels[0]
  if (!r) return null
  return `${tr('last fill-up by {date}', { date: fmtDate(r.after_at) })}${r.litres !== null && r.litres !== undefined ? `, ${tr('about {n} l', { n: fmtNum(r.litres) })}` : ''}`
}

export const REFUEL_NOTES = [
  msg('A fill-up is a rise of the fuel level between two status reports: it happened some time between the two.'),
  msg('The litres are what the gauge gained. Fuel burned between the two reports is not seen, so the real amount is a little higher.'),
  msg('The cost is an estimate: the litres times your price for that day. "Paid" is what you noted in fuel_log.yaml, matched to the fill-up nearest its date (up to 3 days away): a likely or uncertain match is marked when the date is off or the litres disagree.'),
] as const
