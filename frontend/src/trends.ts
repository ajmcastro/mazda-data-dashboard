// Pure logic of the Trends page: which metrics there are, how a month is compared with the
// previous one, and how the comparison is worded. No React in here, so it can be unit tested.

import { locale, msg, tr } from './i18n'
import type { MonthMetrics } from './api/types'
import {
  consumptionDigits, consumptionHigherIsBetter, consumptionLabel, distanceLabel, per100Label, pressureDigits, pressureLabel,
  speedLabel, toConsumption, toDistance, toPer100, toPressure, toSpeed,
} from './units'

export type MetricKey = Exclude<keyof MonthMetrics, 'month' | 'days_in_month' | 'days_covered' | 'partial' | 'currency'>
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
  /** An amount of money: `¤` in the unit stands for the currency (an ISO code) the model's settings give. */
  money?: boolean
  /** What kind of figure it is, when the reader can choose its unit (PLAN.md M45). `unit` and `digits` above
   *  are those of the data (km, l/100 km, kPa); what is shown comes from `unitFor`, `digitsFor`, `shown`. */
  quantity?: Quantity
}

/** `per100` is an amount per 100 km (a cost), which becomes an amount per 100 miles. */
export type Quantity = 'distance' | 'consumption' | 'speed' | 'pressure' | 'per100'

/** A figure in the data's unit, as it is shown in the reader's unit. Linear for all but consumption. */
export function shown(def: MetricDef, v: number | null): number | null {
  switch (def.quantity) {
    case 'distance': return toDistance(v)
    case 'consumption': return toConsumption(v)
    case 'speed': return toSpeed(v)
    case 'pressure': return toPressure(v)
    case 'per100': return toPer100(v)
    default: return v
  }
}

/** Which direction is an improvement in the unit shown: km/l and mpg turn "lower is better" round. */
export const polarityOf = (def: MetricDef): Polarity =>
  def.quantity === 'consumption' && consumptionHigherIsBetter() ? (def.polarity === 'lower' ? 'higher' : def.polarity === 'higher' ? 'lower' : 'neutral') : def.polarity

export const METRICS: MetricDef[] = [
  { key: 'distance_km', quantity: 'distance', label: msg('Distance driven'), unit: msg('km'), digits: 0, additive: true, polarity: 'neutral', perDayUnit: msg('km/day'), perDayDigits: 1, help: msg('From the odometer.') },
  { key: 'l_per_100km', quantity: 'consumption', label: msg('Fuel consumption'), unit: msg('l/100 km'), digits: 2, additive: false, polarity: 'lower', help: msg('Average of the car’s trip counters.') },
  { key: 'fuel_l_est', label: msg('Fuel used (estimated)'), unit: msg('l'), digits: 0, additive: true, polarity: 'neutral', perDayUnit: msg('l/day'), perDayDigits: 1, help: msg('Distance × consumption.') },
  { key: 'days_driven', label: msg('Days driven'), unit: msg('days'), digits: 0, additive: true, polarity: 'neutral', perDayUnit: msg('% of days'), perDayDigits: 0, asShareOfDays: true, help: msg('Days with at least one recorded drive.') },
  { key: 'drives', label: msg('Drives recorded'), unit: msg('drives'), digits: 0, additive: true, polarity: 'neutral', perDayUnit: msg('drives/day'), perDayDigits: 1, help: msg('Stretches between two status snapshots with driving.') },
  { key: 'driving_hours', label: msg('Time driving'), unit: msg('h'), digits: 1, additive: true, polarity: 'neutral', perDayUnit: msg('h/day'), perDayDigits: 2, help: msg('From the trip counters.') },
  { key: 'avg_speed_kmh', quantity: 'speed', label: msg('Average speed'), unit: msg('km/h'), digits: 1, additive: false, polarity: 'neutral', help: msg('Distance divided by driving time.') },
  { key: 'warning_events', label: msg('Warning events'), unit: msg('events'), digits: 0, additive: true, polarity: 'lower', perDayUnit: msg('events/day'), perDayDigits: 1, help: msg('Warning-lamp events reported by the car.') },
  { key: 'warning_codes', label: msg('Different warnings'), unit: msg('codes'), digits: 0, additive: false, polarity: 'lower', help: msg('How many distinct warning codes appeared.') },
  { key: 'fault_readouts', label: msg('Read-outs with faults'), unit: msg('read-outs'), digits: 0, additive: true, polarity: 'lower', perDayUnit: msg('read-outs/day'), perDayDigits: 2, help: msg('Diagnostic read-outs that listed at least one fault.') },
  { key: 'distinct_faults', label: msg('Different faults'), unit: msg('faults'), digits: 0, additive: false, polarity: 'lower', help: msg('Distinct trouble codes reported.') },
  { key: 'new_faults', label: msg('New faults'), unit: msg('faults'), digits: 0, additive: true, polarity: 'lower', perDayUnit: msg('faults/day'), perDayDigits: 2, help: msg('Trouble codes seen for the first time.') },
  { key: 'cost_per_100km', quantity: 'per100', label: msg('Fuel cost (estimated)'), unit: msg('¤/100 km'), digits: 2, additive: false, polarity: 'lower', money: true, help: msg('An estimate: the litres the car reports times the fuel price you entered in settings.yaml, trip by trip. Not what you paid.') },
  { key: 'fuel_cost_est', label: msg('Fuel cost, total (estimated)'), unit: msg('¤'), digits: 0, additive: true, polarity: 'neutral', money: true, perDayUnit: msg('¤/day'), perDayDigits: 2, help: msg('Estimated distance × cost per km: an estimate from your fuel price, not what you paid.') },
  { key: 'tire_avg_kpa', quantity: 'pressure', label: msg('Tire pressure (average)'), unit: msg('kPa'), digits: 0, additive: false, polarity: 'neutral', help: msg('Average of the four tires.') },
  { key: 'tire_min_kpa', quantity: 'pressure', label: msg('Lowest tire reading'), unit: msg('kPa'), digits: 0, additive: false, polarity: 'higher', help: msg('The lowest single reading of the month.') },
]

/** The value to chart for a month, in the unit shown, or null when there is none (a gap, never a zero). */
export const metricValue = (row: MonthMetrics, def: MetricDef, perDay: boolean): number | null => shown(def, rawValue(row, def, perDay))

/** The same in the data's own unit: what sums and weighted means are made from (never from converted values). */
export function rawValue(row: MonthMetrics, def: MetricDef, perDay: boolean): number | null {
  const raw = row[def.key]
  if (raw === null || raw === undefined) return null
  if (!perDay || !def.additive) return raw
  if (row.days_covered <= 0) return null
  return def.asShareOfDays ? (raw / row.days_covered) * 100 : raw / row.days_covered
}

/** The currency of the cost figures in these rows (null when no fuel price is set). */
export const currencyOf = (rows: readonly MonthMetrics[]): string | null => rows.find((r) => r.currency)?.currency ?? null

export const unitFor = (def: MetricDef, perDay: boolean, currency: string | null = null) => {
  const perDayTotal = perDay && def.additive
  const unit =
    def.quantity === 'distance' ? (perDayTotal ? `${distanceLabel()}/${tr('day')}` : distanceLabel())
    : def.quantity === 'consumption' ? consumptionLabel()
    : def.quantity === 'speed' ? speedLabel()
    : def.quantity === 'pressure' ? pressureLabel()
    : def.quantity === 'per100' ? `¤/${per100Label()}`
    : tr(perDayTotal ? def.perDayUnit ?? def.unit : def.unit)
  return def.money ? unit.replace('¤', currency ?? '').trim() : unit
}

// the counted things and their singular (English adds an s; another language has its own word)
const COUNTABLE: Record<string, string> = {
  days: msg('day'), drives: msg('drive'), events: msg('event'), codes: msg('code'), 'read-outs': msg('read-out'), faults: msg('fault'),
}
/** "1 fault", "2 faults": the singular for counted things when the value is exactly 1. */
export const unitLabel = (def: MetricDef, perDay: boolean, value: number | null, currency: string | null = null) => {
  const counted = !def.quantity && !(perDay && def.additive) ? COUNTABLE[def.unit] : undefined
  return value === 1 && counted ? tr(counted) : unitFor(def, perDay, currency)
}

/** Short text for a table cell: "12.3%", "new" (up from nothing), "=" (nothing both months). */
export function shortChange(c: Extract<Comparison, { kind: 'ok' }>): string {
  if (c.pct !== null) return `${Math.abs(c.pct).toFixed(1)}%`
  return c.direction === 'flat' ? '=' : c.direction === 'up' ? tr('new') : tr('none')
}
export const digitsFor = (def: MetricDef, perDay: boolean) =>
  def.quantity === 'pressure' ? pressureDigits()
  : def.quantity === 'consumption' ? consumptionDigits(def.digits)
  : perDay && def.additive ? def.perDayDigits ?? def.digits : def.digits

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
    tone: toneFor(polarityOf(def), direction),
    partialCaveat: def.additive && !perDay && Boolean(partial[index] || partial[index - 1]),
  }
}

/** "2026-05" -> "May 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale(), { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** "2026-05" -> "May" */
export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' })
}

/** Index of the newest month that has a value, or -1. */
export function latestIndex(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null && values[i] !== undefined) return i
  return -1
}

/** Wording of a comparison, e.g. "12.3% more than May 2026". */
export function describeChange(c: Comparison, previousMonth: string | undefined): string {
  const prev = previousMonth ? monthLabel(previousMonth) : tr('the previous month')
  switch (c.kind) {
    case 'no-value':
      return tr('no data this month')
    case 'first':
      return tr('no previous month in this period')
    case 'missing-previous':
      return tr('no data for {prev} to compare with', { prev })
    case 'ok':
      if (c.direction === 'flat') return tr('unchanged from {prev}', { prev })
      if (c.pct === null) return c.direction === 'up' ? tr('up from none in {prev}', { prev }) : tr('down to none in {prev}', { prev })
      return c.direction === 'up' ? tr('{pct}% more than {prev}', { pct: Math.abs(c.pct).toFixed(1), prev }) : tr('{pct}% less than {prev}', { pct: Math.abs(c.pct).toFixed(1), prev })
  }
}

export const ARROW = { up: '▲', down: '▼', flat: '▬' } as const
