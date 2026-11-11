import { describe, expect, it } from 'vitest'
import type { MonthMetrics } from './api/types'
import {
  COMPARABILITY,
  alignMonths,
  compareMetric,
  describeBasis,
  describeDifference,
  pickPair,
  summarise,
  type Series,
} from './compare'
import { METRICS } from './trends'

const def = (key: string) => METRICS.find((m) => m.key === key)!
const row = (month: string, extra: Partial<MonthMetrics> = {}): MonthMetrics => ({
  month,
  days_in_month: 30,
  days_covered: 30,
  partial: false,
  ...extra,
})
const series = (label: string, rows: MonthMetrics[]): Series => ({ label, rows })
const names = { a: 'CX-5', b: 'CX-60' }

// the shape of the two demo cars: the CX-5 runs March-June, the CX-60 April-July, each with partial ends
const cx5 = series('CX-5', [
  row('2026-03', { partial: true, days_covered: 31, days_in_month: 31, distance_km: 900, l_per_100km: 7.0 }),
  row('2026-04', { distance_km: 600, l_per_100km: 7.0 }),
  row('2026-05', { days_in_month: 31, days_covered: 31, distance_km: 620, l_per_100km: 7.0 }),
  row('2026-06', { distance_km: 600, l_per_100km: 7.0 }),
])
const cx60 = series('CX-60', [
  row('2026-04', { partial: true, days_covered: 21, distance_km: 420, l_per_100km: 8.0 }),
  row('2026-05', { days_in_month: 31, days_covered: 31, distance_km: 620, l_per_100km: 8.0 }),
  row('2026-06', { distance_km: 900, l_per_100km: 8.0 }),
  row('2026-07', { partial: true, days_in_month: 31, days_covered: 31, distance_km: 31, l_per_100km: 8.0 }),
])

describe('alignMonths', () => {
  it('keeps the months both cars have complete (May and June for the demo cars)', () => {
    const aligned = alignMonths(cx5, cx60, 'overlap', false)
    expect(aligned.map((m) => m.month)).toEqual(['2026-05', '2026-06'])
    expect(aligned.every((m) => m.a && m.b)).toBe(true)
  })
  it('can include the months that are not complete', () => {
    expect(alignMonths(cx5, cx60, 'overlap', true).map((m) => m.month)).toEqual(['2026-04', '2026-05', '2026-06'])
  })
  it('shows every month either car has, with gaps where one has none, never zeros', () => {
    const aligned = alignMonths(cx5, cx60, 'all', false)
    expect(aligned.map((m) => m.month)).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(aligned[0].a?.month).toBe('2026-04')
    expect(aligned[0].b).toBeUndefined() // the CX-60's April is partial
    expect(alignMonths(cx5, cx60, 'all', true).map((m) => m.month)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
  })
  it('is empty when the cars never overlap', () => {
    const late = series('late', [row('2027-01')])
    expect(alignMonths(cx5, late, 'overlap', false)).toEqual([])
    expect(describeBasis([], 'overlap', false)).toMatch(/no month for which both cars have complete data/)
  })
})

describe('summarise', () => {
  it('weights litres per 100 km by the distance of each month', () => {
    const rows = [row('2026-05', { distance_km: 100, l_per_100km: 10 }), row('2026-06', { distance_km: 300, l_per_100km: 6 })]
    expect(summarise(def('l_per_100km'), rows, false)).toEqual({ value: 7, months: 2 }) // (10*100 + 6*300) / 400
  })
  it('is total over total days for a per-day figure, so a longer month counts for more', () => {
    const rows = [row('2026-05', { days_covered: 31, distance_km: 620 }), row('2026-06', { days_covered: 10, distance_km: 100, partial: true })]
    expect(summarise(def('distance_km'), rows, true).value).toBeCloseTo(720 / 41)
  })
  it('leaves a gap out and counts only the months behind the number', () => {
    const rows = [row('2026-05', { distance_km: 600 }), row('2026-06')]
    expect(summarise(def('distance_km'), rows, false)).toEqual({ value: 600, months: 1 })
    expect(summarise(def('distance_km'), [], false)).toEqual({ value: null, months: 0 })
  })
  it('falls back to a plain mean when every weight is zero', () => {
    const rows = [row('2026-05', { distance_km: 0, l_per_100km: 8 }), row('2026-06', { distance_km: 0, l_per_100km: 6 })]
    expect(summarise(def('l_per_100km'), rows, false).value).toBe(7)
  })
})

describe('compareMetric', () => {
  const aligned = alignMonths(cx5, cx60, 'overlap', false)

  it('compares the same months for both cars and says how many there are', () => {
    const c = compareMetric(def('l_per_100km'), aligned, false, 'overlap')
    expect(c.kind).toBe('ok')
    expect(c.a).toEqual({ value: 7, months: 2 })
    expect(c.b).toEqual({ value: 8, months: 2 })
    expect(c.months).toEqual(['2026-05', '2026-06'])
    expect(c.delta).toBeCloseTo(1)
    expect(c.pct).toBeCloseTo((1 / 7) * 100)
    expect(c.direction).toBe('up')
  })

  it('on the overlap basis only months with a value in both cars count', () => {
    const a = series('a', [row('2026-05', { distance_km: 600 }), row('2026-06', { distance_km: 600 })])
    const b = series('b', [row('2026-05', { distance_km: 300 }), row('2026-06')]) // no distance in June
    const c = compareMetric(def('distance_km'), alignMonths(a, b, 'overlap', false), false, 'overlap')
    expect(c.a).toEqual({ value: 600, months: 1 })
    expect(c.b).toEqual({ value: 300, months: 1 })
    expect(c.months).toEqual(['2026-05'])
  })

  it('on the all-data basis each car uses its own months', () => {
    const c = compareMetric(def('distance_km'), alignMonths(cx5, cx60, 'all', true), false, 'all')
    expect(c.a.months).toBe(4)
    expect(c.b.months).toBe(4)
    expect(c.a.value).toBeCloseTo((900 + 600 + 620 + 600) / 4)
  })

  it('has no percentage when the first value is zero, and reports a one-sided metric', () => {
    const a = series('a', [row('2026-05', { warning_events: 0 })])
    const b = series('b', [row('2026-05', { warning_events: 3 })])
    const z = compareMetric(def('warning_events'), alignMonths(a, b, 'overlap', false), false, 'overlap')
    expect(z).toMatchObject({ kind: 'ok', pct: null, direction: 'up' })
    const gap = series('b', [row('2026-05')])
    expect(compareMetric(def('warning_events'), alignMonths(a, gap, 'overlap', false), false, 'overlap').kind).toBe('none')
    expect(compareMetric(def('warning_events'), alignMonths(a, gap, 'all', false), false, 'all').kind).toBe('one-sided')
  })

  it('shows the figures but no difference for a metric that is not comparable', () => {
    const a = series('a', [row('2026-05', { warning_codes: 4 })])
    const b = series('b', [row('2026-05', { warning_codes: 9 })])
    const c = compareMetric(def('warning_codes'), alignMonths(a, b, 'overlap', false), false, 'overlap')
    expect(c).toMatchObject({ kind: 'not-comparable', delta: null, pct: null })
    expect([c.a.value, c.b.value]).toEqual([4, 9])
  })

  it('calls figures within half a percent the same', () => {
    const a = series('a', [row('2026-05', { distance_km: 1000 })])
    const b = series('b', [row('2026-05', { distance_km: 1003 })])
    expect(compareMetric(def('distance_km'), alignMonths(a, b, 'overlap', false), false, 'overlap').direction).toBe('flat')
  })
})

describe('wording', () => {
  const aligned = alignMonths(cx5, cx60, 'overlap', false)

  it('states the difference neutrally, with both figures', () => {
    const c = compareMetric(def('l_per_100km'), aligned, false, 'overlap')
    expect(describeDifference(def('l_per_100km'), names, c, false)).toBe('CX-60 is 14.3% higher than CX-5 (8.00 l/100 km against 7.00 l/100 km)')
    const lower = compareMetric(def('l_per_100km'), alignMonths(cx60, cx5, 'overlap', false), false, 'overlap')
    expect(describeDifference(def('l_per_100km'), { a: 'CX-60', b: 'CX-5' }, lower, false)).toMatch(/CX-5 is 12\.5% lower than CX-60/)
  })
  it('never uses a verdict word', () => {
    for (const d of METRICS) {
      const text = describeDifference(d, names, compareMetric(d, aligned, true, 'overlap'), true)
      expect(text).not.toMatch(/better|worse|improv|regress|good|bad/i)
    }
  })
  it('says so when there is nothing to compare', () => {
    const none = compareMetric(def('distance_km'), [], false, 'overlap')
    expect(describeDifference(def('distance_km'), names, none, false)).toBe('no data for either car in these months')
    const a = series('a', [row('2026-05', { distance_km: 5 })])
    const gap = series('b', [row('2026-05')])
    const one = compareMetric(def('distance_km'), alignMonths(a, gap, 'all', false), false, 'all')
    expect(describeDifference(def('distance_km'), names, one, false)).toBe('CX-60 has no data for this in these months')
  })
  it('explains why a metric is not compared', () => {
    const a = series('a', [row('2026-05', { warning_codes: 4 })])
    const b = series('b', [row('2026-05', { warning_codes: 9 })])
    const c = compareMetric(def('warning_codes'), alignMonths(a, b, 'overlap', false), false, 'overlap')
    expect(describeDifference(def('warning_codes'), names, c, false)).toMatch(/^not compared: each model has its own set of codes/)
  })
  it('names the months behind the comparison', () => {
    expect(describeBasis(aligned, 'overlap', false)).toBe('2 complete months in common (May 2026 – Jun 2026)')
    expect(describeBasis(aligned.slice(0, 1), 'overlap', true)).toBe('1 month in common (May 2026)')
    expect(describeBasis(alignMonths(cx5, cx60, 'all', true), 'all', true)).toBe('5 months in all (Mar 2026 – Jul 2026)')
  })
})

describe('COMPARABILITY', () => {
  it('has an entry, with a reason, for every metric (a new metric must decide)', () => {
    for (const d of METRICS) {
      expect(COMPARABILITY[d.key], d.key).toBeDefined()
      expect(COMPARABILITY[d.key].why.length).toBeGreaterThan(10)
    }
    expect(Object.keys(COMPARABILITY).sort()).toEqual(METRICS.map((d) => d.key).sort())
  })
  it('keeps usage figures comparable and the reporting ones guarded', () => {
    expect(COMPARABILITY.distance_km.level).toBe('comparable')
    expect(COMPARABILITY.l_per_100km.level).toBe('caution')
    expect(COMPARABILITY.warning_events.level).toBe('caution')
    expect(COMPARABILITY.warning_codes.level).toBe('no')
  })
})

describe('pickPair', () => {
  const cars = [{ id: 'cx5' }, { id: 'cx60' }, { id: 'mx30' }]
  it('uses the cars the address asks for', () => {
    expect(pickPair(cars, { a: 'cx60', b: 'mx30' }, 'cx5')).toEqual({ a: cars[1], b: cars[2] })
  })
  it('starts from the model on screen and the first other one', () => {
    expect(pickPair(cars, {}, 'cx60')).toEqual({ a: cars[1], b: cars[0] })
    expect(pickPair(cars, {}, undefined)).toEqual({ a: cars[0], b: cars[1] })
  })
  it('never picks the same car twice or an unknown one', () => {
    expect(pickPair(cars, { a: 'cx5', b: 'cx5' }, 'cx5')).toEqual({ a: cars[0], b: cars[1] })
    expect(pickPair(cars, { a: 'nope', b: 'gone' }, 'cx5')).toEqual({ a: cars[0], b: cars[1] })
  })
  it('has no second car when there is only one', () => {
    expect(pickPair([cars[0]], {}, 'cx5')).toEqual({ a: cars[0], b: undefined })
    expect(pickPair([], {}, undefined)).toEqual({ a: undefined, b: undefined })
  })
})
