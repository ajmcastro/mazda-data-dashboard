// Pure wording of the tire leak forecast (PLAN.md M51). No React in here.
// A forecast is a rate against the other three wheels and "at this rate": never a promise, and a wheel that is
// not losing pressure says nothing at all.

import type { TireForecast, WheelForecast } from './api/types'
import { fmtDate, fmtNum } from './lib'
import { pressureDigits, pressureLabel, pressureText, toPressure } from './units'

export const WHEEL_NAME: Record<string, string> = { fl: 'front left', fr: 'front right', rl: 'rear left', rr: 'rear right' }
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
  `Based on ${fmtNum(w.measurements)} measurements over ${fmtNum(w.span_days)} days${w.refilled_at ? `, since it was refilled on ${fmtDate(w.refilled_at)}` : ''}.`

/** One wheel in words, or null for a wheel that is not losing pressure (it says nothing). */
export function wheelLine(w: WheelForecast, limitKpa: number): string | null {
  if (!w.losing || w.kpa_per_week === null || w.kpa_per_week === undefined) return null
  const name = WHEEL_NAME[w.wheel] ?? w.wheel
  const rate = `${name[0].toUpperCase()}${name.slice(1)}: losing about ${lossText(w.kpa_per_week)} a week against the other three`
  let outcome: string
  if (w.below_limit) outcome = `it reads ${pressureText(w.current_kpa)}, already at or under your ${pressureText(limitKpa)} limit`
  else if (w.reaches_limit_on) outcome = `at this rate it reaches ${pressureText(limitKpa)} around ${fmtDate(w.reaches_limit_on)}`
  else outcome = `at this rate it is more than a year from ${pressureText(limitKpa)}`
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
  const rate = `losing about ${lossText(w.kpa_per_week)} a week against the other three`
  if (w.below_limit) return rate
  if (w.reaches_limit_on) return `${rate}; ${pressureText(limitKpa)} around ${fmtDate(w.reaches_limit_on)} at this rate`
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
  `A wheel is compared with the mean of the other three at each measurement of the last ${fmtNum(d.window_days)} days, so weather that moves all four together does not count. ` +
  `It needs ${fmtNum(d.min_measurements)} measurements over ${fmtNum(d.min_span_days)} days; a wheel that is not losing pressure is not mentioned.`
