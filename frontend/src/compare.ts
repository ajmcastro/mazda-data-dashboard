// Pure logic of the Compare page: which months two cars are compared over, what each car's figure
// is, how the difference is worded and which metrics are fair to compare at all. No React in here,
// so it can be unit tested. It works on `Series` (a label and monthly rows), not on models, so
// comparing two periods of one car can reuse it later.

import type { MonthMetrics } from './api/types'
import { fmtNum } from './lib'
import { digitsFor, metricValue, monthLabel, unitFor, type MetricDef, type MetricKey } from './trends'

export type Series = { label: string; rows: MonthMetrics[] }

/** The two cars' currencies for the cost figures (null: no fuel price set). */
export type Currencies = { a: string | null; b: string | null }

/** Is a figure fair to compare across two cars? */
export type Level = 'comparable' | 'caution' | 'no'

export const LEVEL_LABEL: Record<Level, string> = {
  comparable: 'comparable',
  caution: 'compare with care',
  no: 'not comparable',
}

/**
 * Usage figures are comparable: they describe how the car is driven. Figures about how the car
 * *reports* (warnings, faults) or that depend on the car's specification are not safe to read
 * across two models, so every metric says which it is and why.
 */
export const COMPARABILITY: Record<MetricKey, { level: Level; why: string }> = {
  distance_km: { level: 'comparable', why: 'It describes how the car is used, not how it reports.' },
  l_per_100km: {
    level: 'caution',
    why: 'Only like for like: a plug-in hybrid’s figure hides the electric part, and different fuels differ.',
  },
  fuel_l_est: {
    level: 'caution',
    why: 'Distance × consumption, so the same caution as the fuel consumption applies.',
  },
  days_driven: { level: 'comparable', why: 'It describes how the car is used.' },
  drives: { level: 'comparable', why: 'It describes how the car is used.' },
  driving_hours: { level: 'comparable', why: 'It describes how the car is used.' },
  avg_speed_kmh: { level: 'comparable', why: 'It describes how the car is used.' },
  warning_events: {
    level: 'caution',
    why: 'Warning codes, and how often a platform logs them, differ between models.',
  },
  warning_codes: {
    level: 'no',
    why: 'Each model has its own set of codes: the counts are different vocabularies.',
  },
  fault_readouts: {
    level: 'caution',
    why: 'What a platform lists as a fault, and how often it reads them out, differs between models.',
  },
  distinct_faults: {
    level: 'caution',
    why: 'Trouble codes and what counts as a fault differ between models.',
  },
  new_faults: {
    level: 'caution',
    why: 'Trouble codes and what counts as a fault differ between models.',
  },
  cost_per_100km: {
    level: 'caution',
    why: 'An estimate from the fuel price entered for each car: different prices and fuels make different costs, and the currencies must match.',
  },
  fuel_cost_est: {
    level: 'caution',
    why: 'An estimate from the fuel price entered for each car, so the same caution applies, and the currencies must match.',
  },
  tire_avg_kpa: { level: 'caution', why: 'The recommended tire pressure differs from car to car.' },
  tire_min_kpa: { level: 'caution', why: 'The recommended tire pressure differs from car to car.' },
}

export type Basis = 'overlap' | 'all'

export type AlignedMonth = { month: string; a?: MonthMetrics; b?: MonthMetrics }

/**
 * The months to look at, by calendar month. Months that are not complete are left out unless asked
 * for (a half month is the main way to compare unfairly). `overlap` keeps only the months both cars
 * have; `all` keeps every month either car has, with gaps (never zeros) where one has none.
 */
export function alignMonths(a: Series, b: Series, basis: Basis, includePartial: boolean): AlignedMonth[] {
  const usable = (rows: MonthMetrics[]) => new Map(rows.filter((r) => includePartial || !r.partial).map((r) => [r.month, r]))
  const left = usable(a.rows)
  const right = usable(b.rows)
  const months = [...new Set([...left.keys(), ...right.keys()])].sort()
  return months
    .filter((m) => basis === 'all' || (left.has(m) && right.has(m)))
    .map((month) => ({ month, a: left.get(month), b: right.get(month) }))
}

/** Metrics that are averaged by something other than the number of months (a rate by what it is a rate of). */
const WEIGHT: Partial<Record<MetricKey, keyof MonthMetrics>> = {
  l_per_100km: 'distance_km',
  avg_speed_kmh: 'driving_hours',
}

export type Summary = { value: number | null; months: number }

/**
 * A car's figure over some months: the mean of the monthly values, each weighted by what it covers
 * (days for a per-day total, distance for litres per 100 km, driving time for the average speed), so
 * that a month with more driving counts for more. `months` is how many months are behind the number.
 */
export function summarise(def: MetricDef, rows: MonthMetrics[], perDay: boolean): Summary {
  let sum = 0
  let weights = 0
  let plain = 0
  let months = 0
  for (const row of rows) {
    const v = metricValue(row, def, perDay)
    if (v === null) continue
    const key = def.additive && perDay ? 'days_covered' : WEIGHT[def.key]
    const raw = key ? Number(row[key] ?? 0) : 1
    const w = raw > 0 ? raw : 0
    sum += v * w
    weights += w
    plain += v
    months += 1
  }
  if (months === 0) return { value: null, months: 0 }
  return { value: weights > 0 ? sum / weights : plain / months, months }
}

export type MetricComparison = {
  kind: 'ok' | 'one-sided' | 'none' | 'not-comparable'
  /** why a figure is shown but not compared, when it is not the metric's general reason */
  reason?: string
  a: Summary
  b: Summary
  /** b − a, only for `ok` */
  delta: number | null
  /** percent difference of b against a; null when a is 0 (a percentage would mean nothing) */
  pct: number | null
  direction: 'up' | 'down' | 'flat' | null
  /** the months both figures stand on (on the overlap basis they are the same for both cars) */
  months: string[]
}

const FLAT_BELOW_PCT = 0.5

/**
 * Compares one metric. On the overlap basis only the months where both cars have a value for this
 * metric count, so both figures stand on the same months; on `all` each car uses its own.
 */
export function compareMetric(
  def: MetricDef,
  aligned: AlignedMonth[],
  perDay: boolean,
  basis: Basis,
  currencies?: Currencies,
): MetricComparison {
  const has = (r: MonthMetrics | undefined) => r !== undefined && metricValue(r, def, perDay) !== null
  const paired = basis === 'overlap' ? aligned.filter((m) => has(m.a) && has(m.b)) : aligned
  const rowsOf = (side: 'a' | 'b') => paired.flatMap((m) => (m[side] ? [m[side]] : []))
  const a = summarise(def, rowsOf('a'), perDay)
  const b = summarise(def, rowsOf('b'), perDay)
  const months = paired.filter((m) => has(m.a) || has(m.b)).map((m) => m.month)
  const empty = { delta: null, pct: null, direction: null }
  if (a.value === null && b.value === null) return { kind: 'none', a, b, ...empty, months }
  if (a.value === null || b.value === null) return { kind: 'one-sided', a, b, ...empty, months }
  if (COMPARABILITY[def.key].level === 'no') return { kind: 'not-comparable', a, b, ...empty, months }
  if (def.money && currencies && currencies.a !== currencies.b) {
    // amounts in two currencies cannot be set against each other without an exchange rate this page does not have
    const reason =
      currencies.a === null || currencies.b === null
        ? 'no fuel price is set for one of the cars'
        : `the cost is in ${currencies.a} for one car and ${currencies.b} for the other`
    return { kind: 'not-comparable', reason, a, b, ...empty, months }
  }
  const delta = b.value - a.value
  const pct = a.value === 0 ? null : (delta / Math.abs(a.value)) * 100
  const direction = pct === null ? (delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down') : Math.abs(pct) < FLAT_BELOW_PCT ? 'flat' : delta > 0 ? 'up' : 'down'
  return { kind: 'ok', a, b, delta, pct, direction, months }
}

const figure = (def: MetricDef, v: number | null, perDay: boolean, currency: string | null) =>
  v === null ? 'no data' : `${fmtNum(v, digitsFor(def, perDay))} ${unitFor(def, perDay, currency)}`

/**
 * The difference in plain words, neutral on purpose: a different car is not an improvement or a
 * regression, so there is no "better" or "worse", only higher and lower with the figures behind it.
 */
export function describeDifference(
  def: MetricDef,
  names: { a: string; b: string },
  c: MetricComparison,
  perDay: boolean,
  currency: string | null = null,
): string {
  switch (c.kind) {
    case 'none':
      return 'no data for either car in these months'
    case 'one-sided':
      return `${c.a.value === null ? names.a : names.b} has no data for this in these months`
    case 'not-comparable':
      return `not compared: ${c.reason ?? COMPARABILITY[def.key].why.toLowerCase()}`
    case 'ok': {
      const both = `(${figure(def, c.b.value, perDay, currency)} against ${figure(def, c.a.value, perDay, currency)})`
      if (c.direction === 'flat') return `${names.b} and ${names.a} are about the same ${both}`
      if (c.pct === null) return `${names.a} has none; ${names.b} has ${figure(def, c.b.value, perDay, currency)}`
      return `${names.b} is ${Math.abs(c.pct).toFixed(1)}% ${c.direction === 'up' ? 'higher' : 'lower'} than ${names.a} ${both}`
    }
  }
}

/** Which months the page compares, for the line under the title. */
export function describeBasis(aligned: AlignedMonth[], basis: Basis, includePartial: boolean): string {
  const complete = includePartial ? '' : 'complete '
  if (aligned.length === 0) {
    return basis === 'overlap'
      ? `There is no month for which both cars have ${complete}data. Show all data to see each car on its own.`
      : 'There is no data to show.'
  }
  const n = aligned.length
  const span = n === 1 ? monthLabel(aligned[0].month) : `${monthLabel(aligned[0].month)} – ${monthLabel(aligned[n - 1].month)}`
  const what = basis === 'overlap' ? 'in common' : 'in all'
  return `${n} ${complete}month${n === 1 ? '' : 's'} ${what} (${span})`
}

type Choice = { id: string }

/**
 * The two cars to compare: what the address asks for when it is valid, otherwise the model on screen
 * and the first other one. Never the same car twice, never one that cannot be compared.
 */
export function pickPair<T extends Choice>(
  choices: readonly T[],
  asked: { a?: string | null; b?: string | null },
  current?: string,
): { a: T | undefined; b: T | undefined } {
  const find = (id?: string | null) => choices.find((c) => c.id === id)
  const a = find(asked.a) ?? find(current) ?? choices[0]
  const b = [find(asked.b), ...choices].find((c) => c !== undefined && c.id !== a?.id)
  return { a, b }
}
