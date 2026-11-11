import { describe, expect, it } from 'vitest'
import type { MonthMetrics } from './api/types'
import {
  COMPARABILITY,
  PERIOD_UNAVAILABLE,
  alignMonths,
  comparePeriods,
  compareMetric,
  describeBasis,
  describeDifference,
  periodLabel,
  periodPresets,
  pickPair,
  summarise,
  summarisePeriod,
  validatePeriods,
  yearAgo,
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

describe('cost across two cars', () => {
  const euros = series('a', [row('2026-05', { currency: 'EUR', cost_per_100km: 12, l_per_100km: 7 })])
  const more = series('b', [row('2026-05', { currency: 'EUR', cost_per_100km: 15, l_per_100km: 8 })])
  const pounds = series('b', [row('2026-05', { currency: 'GBP', cost_per_100km: 15, l_per_100km: 8 })])
  const noPrice = series('b', [row('2026-05', { l_per_100km: 8 })])

  it('compares costs in the same currency, with the currency in the words', () => {
    const aligned = alignMonths(euros, more, 'overlap', false)
    const c = compareMetric(def('cost_per_100km'), aligned, false, 'overlap', { a: 'EUR', b: 'EUR' })
    expect(c.kind).toBe('ok')
    expect(describeDifference(def('cost_per_100km'), names, c, false, 'EUR')).toBe(
      'CX-60 is 25.0% higher than CX-5 (15.00 EUR/100 km against 12.00 EUR/100 km)',
    )
  })
  it('refuses to set amounts in two currencies against each other', () => {
    const c = compareMetric(def('cost_per_100km'), alignMonths(euros, pounds, 'overlap', false), false, 'overlap', { a: 'EUR', b: 'GBP' })
    expect(c).toMatchObject({ kind: 'not-comparable', delta: null, pct: null })
    expect(describeDifference(def('cost_per_100km'), names, c, false, 'EUR')).toBe(
      'not compared: the cost is in EUR for one car and GBP for the other',
    )
  })
  it('says so when only one car has a fuel price', () => {
    const c = compareMetric(def('cost_per_100km'), alignMonths(euros, noPrice, 'all', false), false, 'all', { a: 'EUR', b: null })
    expect(c.kind).toBe('one-sided') // the other car has no cost figure at all
    const both = compareMetric(def('fuel_cost_est'), alignMonths(euros, noPrice, 'all', false), false, 'all', { a: 'EUR', b: null })
    expect(both.kind).toBe('none')
  })
  it('does not apply the currency rule to other metrics', () => {
    const c = compareMetric(def('l_per_100km'), alignMonths(euros, pounds, 'overlap', false), false, 'overlap', { a: 'EUR', b: 'GBP' })
    expect(c.kind).toBe('ok')
  })
  it('has the cost metrics in the comparability table, as a caution', () => {
    expect(COMPARABILITY.cost_per_100km.level).toBe('caution')
    expect(COMPARABILITY.fuel_cost_est.level).toBe('caution')
  })
})

describe('two periods of one car', () => {
  // two months of a car, cut like the Trends route cuts them for a period
  const june = [row('2026-06', { distance_km: 600, drives: 30, days_driven: 20, l_per_100km: 7, cost_per_100km: 13, fuel_cost_est: 78, warning_events: 40, tire_min_kpa: 220, tire_avg_kpa: 230 })]
  const may = [row('2026-05', { days_in_month: 31, days_covered: 31, distance_km: 620, drives: 25, days_driven: 21, l_per_100km: 8, cost_per_100km: 12, fuel_cost_est: 74, warning_events: 20, tire_min_kpa: 225, tire_avg_kpa: 232 })]

  it('adds totals up over the months of a period and averages rates by what they are a rate of', () => {
    const rows = [
      row('2026-05', { distance_km: 100, drives: 10, l_per_100km: 10, days_covered: 10 }),
      row('2026-06', { distance_km: 300, drives: 20, l_per_100km: 6, days_covered: 20 }),
    ]
    expect(summarisePeriod(def('distance_km'), rows, false)).toEqual({ value: 400, months: 2 }) // a total stays a total
    expect(summarisePeriod(def('distance_km'), rows, true).value).toBeCloseTo(400 / 30) // or per day: total over total days
    expect(summarisePeriod(def('drives'), rows, false).value).toBe(30)
    expect(summarisePeriod(def('l_per_100km'), rows, false).value).toBe(7) // weighted by distance
    const tires = [row('2026-05', { tire_min_kpa: 225 }), row('2026-06', { tire_min_kpa: 215 })]
    expect(summarisePeriod(def('tire_min_kpa'), tires, false).value).toBe(215) // the lowest, not an average
    expect(summarisePeriod(def('distance_km'), [], false)).toEqual({ value: null, months: 0 })
  })

  it('weights the cost per 100 km by distance and the average tire pressure by days', () => {
    const rows = [row('2026-05', { distance_km: 100, cost_per_100km: 10, tire_avg_kpa: 200, days_covered: 10 }), row('2026-06', { distance_km: 300, cost_per_100km: 14, tire_avg_kpa: 240, days_covered: 30 })]
    expect(summarise(def('cost_per_100km'), rows, false).value).toBeCloseTo(13)
    expect(summarise(def('tire_avg_kpa'), rows, false).value).toBeCloseTo(230)
  })

  it('compares June with May and tells good from bad for the same car', () => {
    const fuel = comparePeriods(def('l_per_100km'), may, june, false)
    expect(fuel).toMatchObject({ kind: 'ok', direction: 'down', tone: 'good' }) // less fuel: good
    expect(fuel.pct).toBeCloseTo(-12.5)
    const warnings = comparePeriods(def('warning_events'), may, june, false)
    expect(warnings).toMatchObject({ direction: 'up', tone: 'bad' }) // more warnings: bad
    expect(comparePeriods(def('distance_km'), may, june, false).tone).toBe('neutral') // no direction
    expect(comparePeriods(def('tire_min_kpa'), may, june, false)).toMatchObject({ direction: 'down', tone: 'bad' }) // a lower lowest tire reading
  })

  it('names the periods in the neutral wording, with the figures', () => {
    const c = comparePeriods(def('l_per_100km'), may, june, false)
    expect(describeDifference(def('l_per_100km'), { a: 'May 2026', b: 'June 2026' }, c, false)).toBe('June 2026 is 12.5% lower than May 2026 (7.00 l/100 km against 8.00 l/100 km)')
  })

  it('does not pretend to add up the distinct codes of a period', () => {
    const c = comparePeriods(def('warning_codes'), [row('2026-05', { warning_codes: 4 })], [row('2026-06', { warning_codes: 6 })], false)
    expect(c).toMatchObject({ kind: 'not-comparable', tone: 'neutral', delta: null })
    expect(describeDifference(def('warning_codes'), { a: 'A', b: 'B' }, c, false)).toBe(`not compared: ${PERIOD_UNAVAILABLE.warning_codes}`)
    expect(Object.keys(PERIOD_UNAVAILABLE).sort()).toEqual(['distinct_faults', 'warning_codes'])
  })

  it('reports a period without data for a metric', () => {
    expect(comparePeriods(def('distance_km'), [], june, false).kind).toBe('one-sided')
    expect(comparePeriods(def('distance_km'), [], [], false).kind).toBe('none')
  })

  describe('the ready-made pairs', () => {
    const first = '2026-03-01'
    const last = '2026-06-30'
    const preset = (id: string, around?: string) => periodPresets(first, last, around).find((p) => p.id === id)!

    it('counts back from the newest day with data', () => {
      expect(preset('last30')).toMatchObject({ a: { from: '2026-05-02', to: '2026-05-31' }, b: { from: '2026-06-01', to: '2026-06-30' }, available: true })
      expect(preset('month')).toMatchObject({ a: { from: '2026-05-01', to: '2026-05-31' }, b: { from: '2026-06-01', to: '2026-06-30' } })
    })
    it('does not offer a year ago when the data is younger than that', () => {
      expect(preset('year')).toMatchObject({ a: { from: '2025-06-01', to: '2025-06-30' }, available: false })
      const old = periodPresets('2025-01-01', '2026-06-30').find((p) => p.id === 'year')!
      expect(old.available).toBe(true)
    })
    it('offers before and after a date only when a date is given, and cuts the later period at the newest day', () => {
      expect(periodPresets(first, last).some((p) => p.id === 'around')).toBe(false)
      expect(preset('around', '2026-05-15')).toMatchObject({ a: { from: '2026-04-15', to: '2026-05-14' }, b: { from: '2026-05-15', to: '2026-06-13' } })
      expect(preset('around', '2026-06-20').b).toEqual({ from: '2026-06-20', to: '2026-06-30' })
    })
    it('handles the start of the year and a leap day', () => {
      expect(periodPresets('2025-01-01', '2026-01-10').find((p) => p.id === 'month')!.a).toEqual({ from: '2025-12-01', to: '2025-12-31' })
      expect(yearAgo('2028-02-29')).toBe('2027-02-28')
      expect(yearAgo('2026-06-30')).toBe('2025-06-30')
    })
  })

  it('labels whole months by name and other periods by their dates', () => {
    expect(periodLabel({ from: '2026-05-01', to: '2026-05-31' })).toBe('May 2026')
    expect(periodLabel({ from: '2026-02-01', to: '2026-02-28' })).toBe('Feb 2026')
    expect(periodLabel({ from: '2026-05-02', to: '2026-05-31' })).toBe('02 May 2026 – 31 May 2026')
    expect(periodLabel({ from: '2026-05-02', to: '2026-05-02' })).toBe('02 May 2026')
  })

  it('finds what is wrong with two periods', () => {
    const ok = validatePeriods({ from: '2026-05-01', to: '2026-05-31' }, { from: '2026-06-01', to: '2026-06-30' }, '2026-03-01', '2026-06-30')
    expect(ok).toEqual([])
    expect(validatePeriods({ from: '2026-05-31', to: '2026-05-01' }, { from: '2026-06-01', to: '2026-06-30' }, '2026-03-01', '2026-06-30')[0]).toMatch(/first period ends before it starts/)
    expect(validatePeriods({ from: '2024-01-01', to: '2024-01-31' }, { from: '2026-06-01', to: '2026-06-30' }, '2026-03-01', '2026-06-30')[0]).toMatch(/first period has no data/)
    expect(validatePeriods({ from: '2026-05-01', to: '2026-06-10' }, { from: '2026-06-01', to: '2026-06-30' }, '2026-03-01', '2026-06-30')).toContain('The two periods overlap.')
  })
})

