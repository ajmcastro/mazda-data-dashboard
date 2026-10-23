// Pure logic of the Trends page: which metrics there are, how a month is compared with the
// previous one, and how the comparison is worded. No React in here, so it can be unit tested.

import type { MonthMetrics } from './api/types'

export type MetricKey = Exclude<keyof MonthMetrics, 'month' | 'days_in_month' | 'days_covered' | 'partial'>
/** Which direction is an improvement: less fuel is better, a higher lowest tire pressure is better. */
export type Polarity = 'lower' | 'higher' | 'neutral'
export type Tone = 'good' | 'bad' | 'neutral'

export type MetricDef = {
  key: MetricKey
  label: string
  unit: string
  digits: number
  /** Adds up over days (km, events), so it can be shown per day to compare months of unequal length. */
  additive: boolean
  polarity: Polarity
  help: string
  perDayUnit?: string
  perDayDigits?: number
  /** Per day, this is shown as a percentage of the days covered (days driven / days). */
  asShareOfDays?: boolean
}

export const METRICS: MetricDef[] = [
  { key: 'distance_km', label: 'Distance driven', unit: 'km', digits: 0, additive: true, polarity: 'neutral', perDayUnit: 'km/day', perDayDigits: 1, help: 'From the odometer.' },
  { key: 'l_per_100km', label: 'Fuel consumption', unit: 'l/100 km', digits: 2, additive: false, polarity: 'lower', help: 'Average of the car’s trip counters; lower is better.' },
  { key: 'fuel_l_est', label: 'Fuel used (estimated)', unit: 'l', digits: 0, additive: true, polarity: 'neutral', perDayUnit: 'l/day', perDayDigits: 1, help: 'Distance × consumption.' },
  { key: 'days_driven', label: 'Days driven', unit: 'days', digits: 0, additive: true, polarity: 'neutral', perDayUnit: '% of days', perDayDigits: 0, asShareOfDays: true, help: 'Days with at least one recorded drive.' },
  { key: 'drives', label: 'Drives recorded', unit: 'drives', digits: 0, additive: true, polarity: 'neutral', perDayUnit: 'drives/day', perDayDigits: 1, help: 'Stretches between two status snapshots with driving.' },
  { key: 'driving_hours', label: 'Time driving', unit: 'h', digits: 1, additive: true, polarity: 'neutral', perDayUnit: 'h/day', perDayDigits: 2, help: 'From the trip counters.' },
  { key: 'avg_speed_kmh', label: 'Average speed', unit: 'km/h', digits: 1, additive: false, polarity: 'neutral', help: 'Distance divided by driving time.' },
  { key: 'warning_events', label: 'Warning events', unit: 'events', digits: 0, additive: true, polarity: 'lower', perDayUnit: 'events/day', perDayDigits: 1, help: 'Warning-lamp events reported by the car.' },
  { key: 'warning_codes', label: 'Different warnings', unit: 'codes', digits: 0, additive: false, polarity: 'lower', help: 'How many distinct warning codes appeared.' },
  { key: 'fault_readouts', label: 'Read-outs with faults', unit: 'read-outs', digits: 0, additive: true, polarity: 'lower', perDayUnit: 'read-outs/day', perDayDigits: 2, help: 'Diagnostic read-outs that listed at least one fault.' },
  { key: 'distinct_faults', label: 'Different faults', unit: 'faults', digits: 0, additive: false, polarity: 'lower', help: 'Distinct trouble codes reported.' },
  { key: 'new_faults', label: 'New faults', unit: 'faults', digits: 0, additive: true, polarity: 'lower', perDayUnit: 'faults/day', perDayDigits: 2, help: 'Trouble codes seen for the first time.' },
  { key: 'tire_avg_kpa', label: 'Tire pressure (average)', unit: 'kPa', digits: 0, additive: false, polarity: 'neutral', help: 'Average of the four tires.' },
  { key: 'tire_min_kpa', label: 'Lowest tire reading', unit: 'kPa', digits: 0, additive: false, polarity: 'higher', help: 'The lowest single reading of the month.' },
]

/** The value to chart for a month, or null when there is none (a gap, never a zero). */
export function metricValue(row: MonthMetrics, def: MetricDef, perDay: boolean): number | null {
  const raw = row[def.key]
  if (raw === null || raw === undefined) return null
  if (!perDay || !def.additive) return raw
  if (row.days_covered <= 0) return null
  return def.asShareOfDays ? (raw / row.days_covered) * 100 : raw / row.days_covered
}

export const unitFor = (def: MetricDef, perDay: boolean) => (perDay && def.additive ? def.perDayUnit ?? def.unit : def.unit)

const COUNTABLE = new Set(['days', 'drives', 'events', 'codes', 'read-outs', 'faults'])
/** "1 fault", "2 faults": the singular for counted things when the value is exactly 1. */
export const unitLabel = (def: MetricDef, perDay: boolean, value: number | null) => {
  const unit = unitFor(def, perDay)
  return value === 1 && COUNTABLE.has(unit) ? unit.slice(0, -1) : unit
}

/** Short text for a table cell: "12.3%", "new" (up from nothing), "=" (nothing both months). */
export function shortChange(c: Extract<Comparison, { kind: 'ok' }>): string {
  if (c.pct !== null) return `${Math.abs(c.pct).toFixed(1)}%`
  return c.direction === 'flat' ? '=' : c.direction === 'up' ? 'new' : 'none'
}
export const digitsFor = (def: MetricDef, perDay: boolean) =>
  perDay && def.additive ? def.perDayDigits ?? def.digits : def.digits

export type Comparison =
  | { kind: 'no-value' } // this month has no data for the metric
  | { kind: 'first' } // nothing earlier in the selected period
  | { kind: 'missing-previous' } // the previous month exists but has no data for the metric
  | {
      kind: 'ok'
      previous: number
      change: number
      /** Percent change; null when the previous value was 0, where a percentage is meaningless. */
      pct: number | null
      direction: 'up' | 'down' | 'flat'
      tone: Tone
      /** The comparison involves a month that is not complete, so the totals are not like for like. */
      partialCaveat: boolean
    }

const FLAT_BELOW_PCT = 0.5

export function toneFor(polarity: Polarity, direction: 'up' | 'down' | 'flat'): Tone {
  if (polarity === 'neutral' || direction === 'flat') return 'neutral'
  const improved = (polarity === 'lower' && direction === 'down') || (polarity === 'higher' && direction === 'up')
  return improved ? 'good' : 'bad'
}

/** How month `index` compares with the month right before it (not the last month that has data). */
export function compare(
  def: MetricDef,
  values: (number | null)[],
  partial: boolean[],
  index: number,
  perDay = false,
): Comparison {
  const current = values[index]
  if (current === null || current === undefined) return { kind: 'no-value' }
  if (index === 0) return { kind: 'first' }
  const previous = values[index - 1]
  if (previous === null || previous === undefined) return { kind: 'missing-previous' }
  const change = current - previous
  const pct = previous === 0 ? null : (change / Math.abs(previous)) * 100
  const direction =
    pct === null ? (change === 0 ? 'flat' : change > 0 ? 'up' : 'down') : Math.abs(pct) < FLAT_BELOW_PCT ? 'flat' : change > 0 ? 'up' : 'down'
  return {
    kind: 'ok',
    previous,
    change,
    pct,
    direction,
    tone: toneFor(def.polarity, direction),
    partialCaveat: def.additive && !perDay && Boolean(partial[index] || partial[index - 1]),
  }
}

/** "2026-05" -> "May 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** "2026-05" -> "May" */
export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
}

/** Index of the newest month that has a value, or -1. */
export function latestIndex(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null && values[i] !== undefined) return i
  return -1
}

/** Wording of a comparison, e.g. "12.3% more than May 2026". */
export function describeChange(c: Comparison, previousMonth: string | undefined): string {
  const prev = previousMonth ? monthLabel(previousMonth) : 'the previous month'
  switch (c.kind) {
    case 'no-value':
      return 'no data this month'
    case 'first':
      return 'no previous month in this period'
    case 'missing-previous':
      return `no data for ${prev} to compare with`
    case 'ok':
      if (c.direction === 'flat') return `unchanged from ${prev}`
      if (c.pct === null) return `${c.direction === 'up' ? 'up from none' : 'down to none'} in ${prev}`
      return `${Math.abs(c.pct).toFixed(1)}% ${c.direction === 'up' ? 'more' : 'less'} than ${prev}`
  }
}

export const ARROW = { up: '▲', down: '▼', flat: '▬' } as const
