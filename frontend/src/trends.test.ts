import { describe, expect, it } from 'vitest'
import type { MonthMetrics } from './api/types'
import {
  METRICS,
  compare,
  describeChange,
  digitsFor,
  latestIndex,
  metricValue,
  shortChange,
  unitLabel,
  monthLabel,
  monthShort,
  toneFor,
  unitFor,
} from './trends'

const def = (key: string) => METRICS.find((m) => m.key === key)!
const row = (extra: Partial<MonthMetrics> = {}): MonthMetrics => ({
  month: '2026-05',
  days_in_month: 31,
  days_covered: 31,
  partial: false,
  ...extra,
})

describe('monthLabel', () => {
  it('names months and keeps the year', () => {
    expect(monthLabel('2026-05')).toBe('May 2026')
    expect(monthLabel('2026-12')).toBe('Dec 2026')
    expect(monthShort('2026-01')).toBe('Jan')
  })
})

describe('metricValue', () => {
  it('returns the raw value, or null for a gap (never 0)', () => {
    expect(metricValue(row({ distance_km: 1200 }), def('distance_km'), false)).toBe(1200)
    expect(metricValue(row(), def('distance_km'), false)).toBeNull()
    expect(metricValue(row({ distance_km: 0 }), def('distance_km'), false)).toBe(0)
  })
  it('divides totals by the days covered when asked, so unequal months compare fairly', () => {
    const full = row({ distance_km: 620, days_covered: 31 })
    const half = row({ distance_km: 310, days_covered: 15.5 as unknown as number })
    expect(metricValue(full, def('distance_km'), true)).toBeCloseTo(20)
    expect(metricValue(half, def('distance_km'), true)).toBeCloseTo(20)
  })
  it('leaves rates alone per day, shows days driven as a share of days', () => {
    expect(metricValue(row({ l_per_100km: 7.1 }), def('l_per_100km'), true)).toBe(7.1)
    expect(metricValue(row({ days_driven: 15 }), def('days_driven'), true)).toBeCloseTo((15 / 31) * 100)
    expect(unitFor(def('distance_km'), true)).toBe('km/day')
    expect(unitFor(def('l_per_100km'), true)).toBe('l/100 km')
    expect(digitsFor(def('distance_km'), true)).toBe(1)
  })
  it('does not divide by zero days', () => {
    expect(metricValue(row({ distance_km: 5, days_covered: 0 }), def('distance_km'), true)).toBeNull()
  })
})

describe('toneFor', () => {
  it('depends on which direction is an improvement', () => {
    expect(toneFor('lower', 'down')).toBe('good')
    expect(toneFor('lower', 'up')).toBe('bad')
    expect(toneFor('higher', 'up')).toBe('good')
    expect(toneFor('higher', 'down')).toBe('bad')
    expect(toneFor('neutral', 'up')).toBe('neutral')
    expect(toneFor('lower', 'flat')).toBe('neutral')
  })
})

describe('compare', () => {
  const fuel = def('l_per_100km')
  const none = [false, false, false]

  it('gives the change and percentage against the month before', () => {
    const c = compare(fuel, [6.5, 7.15], [false, false], 1)
    expect(c).toMatchObject({ kind: 'ok', previous: 6.5, direction: 'up', tone: 'bad' })
    if (c.kind === 'ok') expect(c.pct).toBeCloseTo(10)
    const down = compare(fuel, [8, 7.2], [false, false], 1)
    expect(down).toMatchObject({ direction: 'down', tone: 'good' })
  })
  it('has nothing to compare for the first month of the period', () => {
    expect(compare(fuel, [7, 7.2], [false, false], 0)).toEqual({ kind: 'first' })
  })
  it('does not skip over a month without data', () => {
    expect(compare(fuel, [7, null, 7.2], none, 2)).toEqual({ kind: 'missing-previous' })
    expect(compare(fuel, [7, null, 7.2], none, 1)).toEqual({ kind: 'no-value' })
  })
  it('treats tiny changes as unchanged', () => {
    const c = compare(fuel, [7.0, 7.02], [false, false], 1)
    expect(c).toMatchObject({ kind: 'ok', direction: 'flat', tone: 'neutral' })
  })
  it('has no percentage when the previous value was zero', () => {
    const events = def('warning_events')
    expect(compare(events, [0, 12], [false, false], 1)).toMatchObject({ pct: null, direction: 'up', tone: 'bad' })
    expect(compare(events, [0, 0], [false, false], 1)).toMatchObject({ pct: null, direction: 'flat' })
  })
  it('works with negative values and measures change against the size of the old value', () => {
    const c = compare(def('distance_km'), [-10, -5], [false, false], 1)
    if (c.kind === 'ok') expect(c.pct).toBeCloseTo(50)
  })
  it('warns when totals are compared across a partial month, but not for rates or per day', () => {
    const km = def('distance_km')
    expect(compare(km, [300, 900], [true, false], 1)).toMatchObject({ partialCaveat: true })
    expect(compare(km, [300, 900], [true, false], 1, true)).toMatchObject({ partialCaveat: false })
    expect(compare(fuel, [7, 7.4], [true, false], 1)).toMatchObject({ partialCaveat: false })
    expect(compare(km, [900, 800], [false, false], 1)).toMatchObject({ partialCaveat: false })
  })
})

describe('describeChange', () => {
  const fuel = def('l_per_100km')
  it('words every case', () => {
    const up = compare(fuel, [6.5, 7.15], [false, false], 1)
    expect(describeChange(up, '2026-05')).toBe('10.0% more than May 2026')
    expect(describeChange(compare(fuel, [8, 7.2], [false, false], 1), '2026-05')).toBe('10.0% less than May 2026')
    expect(describeChange(compare(fuel, [7, 7.001], [false, false], 1), '2026-05')).toBe('unchanged from May 2026')
    expect(describeChange({ kind: 'first' }, undefined)).toBe('no previous month in this period')
    expect(describeChange({ kind: 'missing-previous' }, '2026-04')).toBe('no data for Apr 2026 to compare with')
    expect(describeChange({ kind: 'no-value' }, undefined)).toBe('no data this month')
    expect(describeChange(compare(def('warning_events'), [0, 3], [false, false], 1), '2026-05')).toBe('up from none in May 2026')
  })
})

describe('latestIndex', () => {
  it('finds the newest month with a value', () => {
    expect(latestIndex([1, 2, null])).toBe(1)
    expect(latestIndex([null, null])).toBe(-1)
    expect(latestIndex([])).toBe(-1)
    expect(latestIndex([0])).toBe(0)
  })
})

describe('wording helpers', () => {
  it('uses the singular for a count of exactly one', () => {
    expect(unitLabel(def('new_faults'), false, 1)).toBe('fault')
    expect(unitLabel(def('new_faults'), false, 2)).toBe('faults')
    expect(unitLabel(def('new_faults'), false, 0)).toBe('faults')
    expect(unitLabel(def('distance_km'), false, 1)).toBe('km') // not a countable unit
    expect(unitLabel(def('days_driven'), true, 1)).toBe('% of days')
  })
  it('does not call nothing-to-nothing "new"', () => {
    const events = def('warning_events')
    const ok = (a: number, b: number) => {
      const c = compare(events, [a, b], [false, false], 1)
      if (c.kind !== 'ok') throw new Error('expected a comparison')
      return shortChange(c)
    }
    expect(ok(0, 0)).toBe('=')
    expect(ok(0, 4)).toBe('new')
    expect(ok(4, 0)).toBe('100.0%')
    expect(ok(10, 12)).toBe('20.0%')
  })
})
