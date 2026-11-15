// Pure logic of the Compare page: which months two cars are compared over, what each car's figure
// is, how the difference is worded and which metrics are fair to compare at all. No React in here,
// so it can be unit tested. It works on `Series` (a label and monthly rows), not on models, so
// comparing two periods of one car can reuse it later.

import { msg, tr, trn } from './i18n'
import type { MonthMetrics } from './api/types'
import { addDays, fmtDate, fmtNum } from './lib'
import { digitsFor, monthLabel, polarityOf, rawValue, shown, toneFor, unitFor, type MetricDef, type MetricKey, type Tone } from './trends'

export type Series = { label: string; rows: MonthMetrics[] }

/** The two cars' currencies for the cost figures (null: no fuel price set). */
export type Currencies = { a: string | null; b: string | null }

/** Is a figure fair to compare across two cars? */
export type Level = 'comparable' | 'caution' | 'no'

export const LEVEL_LABEL: Record<Level, string> = {
  comparable: msg('comparable'),
  caution: msg('compare with care'),
  no: msg('not comparable'),
}

/**
 * Usage figures are comparable: they describe how the car is driven. Figures about how the car
 * *reports* (warnings, faults) or that depend on the car's specification are not safe to read
 * across two models, so every metric says which it is and why.
 */
export const COMPARABILITY: Record<MetricKey, { level: Level; why: string }> = {
  distance_km: { level: 'comparable', why: msg('It describes how the car is used, not how it reports.') },
  l_per_100km: {
    level: 'caution',
    why: msg('Only like for like: a plug-in hybrid’s figure hides the electric part, and different fuels differ.'),
  },
  fuel_l_est: {
    level: 'caution',
    why: msg('Distance × consumption, so the same caution as the fuel consumption applies.'),
  },
  days_driven: { level: 'comparable', why: msg('It describes how the car is used.') },
  drives: { level: 'comparable', why: msg('It describes how the car is used.') },
  driving_hours: { level: 'comparable', why: msg('It describes how the car is used.') },
  avg_speed_kmh: { level: 'comparable', why: msg('It describes how the car is used.') },
  warning_events: {
    level: 'caution',
    why: msg('Warning codes, and how often a platform logs them, differ between models.'),
  },
  warning_codes: {
    level: 'no',
    why: msg('Each model has its own set of codes: the counts are different vocabularies.'),
  },
  fault_readouts: {
    level: 'caution',
    why: msg('What a platform lists as a fault, and how often it reads them out, differs between models.'),
  },
  distinct_faults: {
    level: 'caution',
    why: msg('Trouble codes and what counts as a fault differ between models.'),
  },
  new_faults: {
    level: 'caution',
    why: msg('Trouble codes and what counts as a fault differ between models.'),
  },
  cost_per_100km: {
    level: 'caution',
    why: msg('An estimate from the fuel price entered for each car: different prices and fuels make different costs, and the currencies must match.'),
  },
  fuel_cost_est: {
    level: 'caution',
    why: msg('An estimate from the fuel price entered for each car, so the same caution applies, and the currencies must match.'),
  },
  tire_avg_kpa: { level: 'caution', why: msg('The recommended tire pressure differs from car to car.') },
  tire_min_kpa: { level: 'caution', why: msg('The recommended tire pressure differs from car to car.') },
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
  cost_per_100km: 'distance_km',
  avg_speed_kmh: 'driving_hours',
  tire_avg_kpa: 'days_covered',
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
    const v = rawValue(row, def, perDay) // in the data's unit: a mean of converted values would be wrong for mpg
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
  return { value: shown(def, weights > 0 ? sum / weights : plain / months), months }
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
  const has = (r: MonthMetrics | undefined) => r !== undefined && rawValue(r, def, perDay) !== null
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
        ? tr('no fuel price is set for one of the cars')
        : tr('the cost is in {a} for one car and {b} for the other', { a: currencies.a ?? '', b: currencies.b ?? '' })
    return { kind: 'not-comparable', reason, a, b, ...empty, months }
  }
  return { kind: 'ok', a, b, ...difference(a.value, b.value), months }
}

/** b − a, in percent of a (none when a is 0), and which way it went (within half a percent: flat). */
function difference(a: number, b: number): { delta: number; pct: number | null; direction: 'up' | 'down' | 'flat' } {
  const delta = b - a
  const pct = a === 0 ? null : (delta / Math.abs(a)) * 100
  const direction = pct === null ? (delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down') : Math.abs(pct) < FLAT_BELOW_PCT ? 'flat' : delta > 0 ? 'up' : 'down'
  return { delta, pct, direction }
}

const figure = (def: MetricDef, v: number | null, perDay: boolean, currency: string | null) =>
  v === null ? tr('no data') : `${fmtNum(v, digitsFor(def, perDay))} ${unitFor(def, perDay, currency)}`

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
      return tr('no data for either car in these months')
    case 'one-sided':
      return tr('{car} has no data for this in these months', { car: c.a.value === null ? names.a : names.b })
    case 'not-comparable':
      return tr('not compared: {why}', { why: c.reason ? tr(c.reason) : tr(COMPARABILITY[def.key].why).toLowerCase() })
    case 'ok': {
      const both = `(${tr('{b} against {a}', { b: figure(def, c.b.value, perDay, currency), a: figure(def, c.a.value, perDay, currency) })})`
      if (c.direction === 'flat') return tr('{b} and {a} are about the same {both}', { a: names.a, b: names.b, both })
      if (c.pct === null) return tr('{a} has none; {b} has {figure}', { a: names.a, b: names.b, figure: figure(def, c.b.value, perDay, currency) })
      return c.direction === 'up'
        ? tr('{b} is {pct}% higher than {a} {both}', { a: names.a, b: names.b, pct: Math.abs(c.pct).toFixed(1), both })
        : tr('{b} is {pct}% lower than {a} {both}', { a: names.a, b: names.b, pct: Math.abs(c.pct).toFixed(1), both })
    }
  }
}

/** Which months the page compares, for the line under the title. */
export function describeBasis(aligned: AlignedMonth[], basis: Basis, includePartial: boolean): string {
  if (aligned.length === 0) {
    if (basis !== 'overlap') return tr('There is no data to show.')
    return includePartial
      ? tr('There is no month for which both cars have data. Show all data to see each car on its own.')
      : tr('There is no month for which both cars have complete data. Show all data to see each car on its own.')
  }
  const n = aligned.length
  const span = n === 1 ? monthLabel(aligned[0].month) : `${monthLabel(aligned[0].month)} – ${monthLabel(aligned[n - 1].month)}`
  if (basis === 'overlap') {
    return includePartial
      ? trn('{n} month in common ({span})', '{n} months in common ({span})', n, { span })
      : trn('{n} complete month in common ({span})', '{n} complete months in common ({span})', n, { span })
  }
  return includePartial
    ? trn('{n} month in all ({span})', '{n} months in all ({span})', n, { span })
    : trn('{n} complete month in all ({span})', '{n} complete months in all ({span})', n, { span })
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

// ---- two periods of one car ---------------------------------------------------------------------------

/** What a period (any window of days) can and cannot be built from: the monthly rows inside it. */
export const PERIOD_UNAVAILABLE: Partial<Record<MetricKey, string>> = {
  warning_codes: msg('the number of different warning codes in a period cannot be added up from months'),
  distinct_faults: msg('the number of different faults in a period cannot be added up from months'),
}

/**
 * A car's figure over a period, from the monthly rows inside it (a month cut by the period only counts its days
 * inside it). Totals add up, rates are weighted by what they are a rate of, the lowest tire reading is the lowest
 * of the months; with `perDay` off a total stays a total.
 */
export function summarisePeriod(def: MetricDef, rows: MonthMetrics[], perDay: boolean): Summary {
  if (def.additive && !perDay) {
    const values = rows.map((r) => rawValue(r, def, false)).filter((v): v is number => v !== null)
    return values.length ? { value: shown(def, values.reduce((x, y) => x + y, 0)), months: values.length } : { value: null, months: 0 }
  }
  if (def.key === 'tire_min_kpa') {
    const values = rows.map((r) => rawValue(r, def, false)).filter((v): v is number => v !== null)
    return values.length ? { value: shown(def, Math.min(...values)), months: values.length } : { value: null, months: 0 }
  }
  return summarise(def, rows, perDay)
}

export type PeriodComparison = MetricComparison & {
  /** good / bad for the same car over time (neutral for a metric with no direction, or when not compared) */
  tone: Tone
}

/** Compares one metric of the same car over a period A and a later (or other) period B. */
export function comparePeriods(def: MetricDef, rowsA: MonthMetrics[], rowsB: MonthMetrics[], perDay: boolean): PeriodComparison {
  const none: Summary = { value: null, months: 0 }
  const unavailable = PERIOD_UNAVAILABLE[def.key]
  const empty = { delta: null, pct: null, direction: null, months: [] as string[] }
  if (unavailable) return { kind: 'not-comparable', reason: unavailable, a: none, b: none, ...empty, tone: 'neutral' }
  const a = summarisePeriod(def, rowsA, perDay)
  const b = summarisePeriod(def, rowsB, perDay)
  if (a.value === null && b.value === null) return { kind: 'none', a, b, ...empty, tone: 'neutral' }
  if (a.value === null || b.value === null) return { kind: 'one-sided', a, b, ...empty, tone: 'neutral' }
  const d = difference(a.value, b.value)
  return { kind: 'ok', a, b, ...d, months: [], tone: toneFor(polarityOf(def), d.direction) }
}

export type Period = { from: string; to: string }

const monthStart = (day: string) => `${day.slice(0, 7)}-01`
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const monthEnd = (day: string) => addDays(addDays(monthStart(day), 32).slice(0, 7) + '-01', -1)
const previousMonthEnd = (day: string) => addDays(monthStart(day), -1)

/** The same calendar day a year earlier (29 February becomes 28 February). */
export function yearAgo(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dd = Math.min(d, daysIn(y - 1, m))
  return `${String(y - 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/** "May 2026" for a whole calendar month, else "05 May – 04 Jun 2026". */
export function periodLabel(p: Period): string {
  if (p.from === monthStart(p.from) && p.to === monthEnd(p.from)) return monthLabel(p.from.slice(0, 7))
  return p.from === p.to ? fmtDate(p.from) : `${fmtDate(p.from)} – ${fmtDate(p.to)}`
}

export type PeriodPreset = { id: string; label: string; a: Period; b: Period; available: boolean }

const overlaps = (p: Period, first: string, last: string) => p.to >= first && p.from <= last

/**
 * Ready-made pairs of periods, counted back from the newest day with data (like the date presets: an export is
 * a snapshot). `around` is the date of "before and after a date" (the 30 days before it, and it and the 29 after).
 * A pair is not available when its earlier period has no data at all.
 */
export function periodPresets(first: string, last: string, around?: string): PeriodPreset[] {
  const make = (id: string, label: string, a: Period, b: Period): PeriodPreset => ({ id, label, a, b, available: overlaps(a, first, last) && overlaps(b, first, last) })
  const thisMonth: Period = { from: monthStart(last), to: last }
  const previousEnd = previousMonthEnd(last)
  const list = [
    make('last30', msg('Last 30 days against the 30 before'), { from: addDays(last, -59), to: addDays(last, -30) }, { from: addDays(last, -29), to: last }),
    make('month', msg('This month against the month before'), { from: monthStart(previousEnd), to: previousEnd }, thisMonth),
    make('year', msg('This month against a year ago'), { from: yearAgo(thisMonth.from), to: yearAgo(thisMonth.to) }, thisMonth),
  ]
  if (around) {
    const after = addDays(around, 29)
    list.push(make('around', msg('Before and after a date'), { from: addDays(around, -30), to: addDays(around, -1) }, { from: around, to: after > last ? last : after }))
  }
  return list
}

/** What is wrong with two periods (nothing: an empty list). */
export function validatePeriods(a: Period, b: Period, first: string, last: string): string[] {
  const problems: string[] = []
  for (const [name, p] of [[tr('The first period'), a], [tr('The second period'), b]] as const) {
    if (p.from > p.to) problems.push(tr('{period} ends before it starts.', { period: name }))
    else if (!overlaps(p, first, last)) problems.push(tr('{period} has no data (the data runs from {from} to {to}).', { period: name, from: fmtDate(first), to: fmtDate(last) }))
  }
  if (a.from <= b.to && b.from <= a.to && a.from <= a.to && b.from <= b.to) problems.push(tr('The two periods overlap.'))
  return problems
}
