// Pure wording of the tire leak forecast (PLAN.md M51). No React in here.
// A forecast is a rate against the other three wheels and "at this rate": never a promise, and a wheel that is
// not losing pressure says nothing at all.

import { msg, tr } from './i18n'
import type { TireForecast, WheelForecast } from './api/types'
import { fmtDate, fmtNum } from './lib'
import { pressureDigits, pressureLabel, pressureText, toPressure } from './units'

export const WHEEL_NAME: Record<string, string> = { fl: msg('front left'), fr: msg('front right'), rl: msg('rear left'), rr: msg('rear right') }
/** The car part each wheel of the forecast is (the ids of `car.ts`). */
export const WHEEL_PART: Record<string, string> = { fl: 'wheel_fl', fr: 'wheel_fr', rl: 'wheel_rl', rr: 'wheel_rr' }

/** A loss per week in the reader's unit, as a positive number with its unit (one decimal under ten in the data's unit, the unit's own digits otherwise). */
function lossText(kpaPerWeek: number): string {
  const v = toPressure(Math.abs(kpaPerWeek))
  if (v === null) return '—'
  const digits = pressureDigits() === 0 ? (v < 10 ? 1 : 0) : pressureDigits() // the data's own unit has no decimals
  return `${fmtNum(v, digits)} ${pressureLabel()}`
}

const basis = (w: WheelForecast) =>
  `${tr('Based on {n} measurements over {days} days', { n: fmtNum(w.measurements), days: fmtNum(w.span_days) })}${w.refilled_at ? tr(', since it was refilled on {date}', { date: fmtDate(w.refilled_at) }) : ''}.`

/** One wheel in words, or null for a wheel that is not losing pressure (it says nothing). */
export function wheelLine(w: WheelForecast, limitKpa: number): string | null {
  if (!w.losing || w.kpa_per_week === null || w.kpa_per_week === undefined) return null
  const name = tr(WHEEL_NAME[w.wheel] ?? w.wheel)
  const rate = tr('{wheel}: losing about {loss} a week against the other three', { wheel: `${name[0].toUpperCase()}${name.slice(1)}`, loss: lossText(w.kpa_per_week) })
  let outcome: string
  if (w.below_limit) outcome = tr('it reads {now}, already at or under your {limit} limit', { now: pressureText(w.current_kpa), limit: pressureText(limitKpa) })
  else if (w.reaches_limit_on) outcome = tr('at this rate it reaches {limit} around {date}', { limit: pressureText(limitKpa), date: fmtDate(w.reaches_limit_on) })
  else outcome = tr('at this rate it is more than a year from {limit}', { limit: pressureText(limitKpa) })
  return `${rate}; ${outcome}. ${basis(w)}`
}

/** The lines to show under the tire chart: one per wheel losing pressure. */
export function forecastLines(d: TireForecast | undefined): string[] {
  if (!d) return []
  return d.wheels.map((w) => wheelLine(w, d.limit_kpa)).filter((line): line is string => line !== null)
}

/** A short note for the wheel in the car view, or null. */
export function wheelNote(w: WheelForecast | undefined, limitKpa: number): string | null {
  if (!w || !w.losing || w.kpa_per_week === null || w.kpa_per_week === undefined) return null
  const rate = tr('losing about {loss} a week against the other three', { loss: lossText(w.kpa_per_week) })
  if (w.below_limit) return rate
  if (w.reaches_limit_on) return `${rate}; ${tr('{limit} around {date} at this rate', { limit: pressureText(limitKpa), date: fmtDate(w.reaches_limit_on) })}`
  return rate
}

/** The notes of the forecast by car part id. */
export function notesByPart(d: TireForecast | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const w of d?.wheels ?? []) {
    const note = wheelNote(w, d!.limit_kpa)
    if (note) out[WHEEL_PART[w.wheel] ?? w.wheel] = note
  }
  return out
}

/** What the forecast needs, said once under the lines (or when there is none to show). */
export const forecastBasis = (d: TireForecast): string =>
  `${tr('A wheel is compared with the mean of the other three at each measurement of the last {days} days, so weather that moves all four together does not count. It needs {n} measurements over {span} days; a wheel that is not losing pressure is not mentioned.', {
    days: fmtNum(d.window_days), n: fmtNum(d.min_measurements), span: fmtNum(d.min_span_days),
  })} ${tr(DAILY_NOTE)}`

/**
 * Why a wheel that reads lower in the mornings (it cools faster, or the sun warms the others) is not taken for a
 * leak (M69): the rate is the median of the slopes between pairs of measurements a day or more apart.
 */
export const DAILY_NOTE = msg(
  'The rate is the median over every pair of measurements a day or more apart, so a wheel that reads lower at one time of day than another is not taken for a leak.',
)
