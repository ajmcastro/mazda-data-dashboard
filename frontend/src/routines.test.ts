import { afterEach, describe, expect, it } from 'vitest'
import type { Routine, Routines } from './api/types'
import { tr } from './i18n'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'
import { DEFAULT_UNITS, setUnits } from './units'
import { ROUTINES_NOTE, clock, otherLine, routineLine, routineOf, routineTitle, summaryLine, timeWord, whenWord } from './routines'

const routine = (over: Partial<Routine> = {}): Routine => ({
  routine: 1, stretches: 51, days: 23, km: 359.6, km_share_pct: 9.8, km_median: 6.4, minutes_median: 16.7,
  weekend_pct: 13.7, hour: 18.7, hour_low: 16.5, hour_high: 21.9, l_per_100km: 7.98, ...over,
})
const long = routine({ routine: 2, stretches: 12, days: 11, km: 2614, km_share_pct: 71.3, km_median: 278.5, minutes_median: 143.2, weekend_pct: 66.7, hour: 18.7, l_per_100km: 6.43 })
const answer = (routines: Routine[], over: Partial<Routines> = {}): Routines => ({
  enough: true, stretches: 192, km: 3666, k: 6, silhouette: 0.33, clear: true, min_stretches: 8, min_days: 4, min_silhouette: 0.25,
  routines, other_stretches: 129, other_km: 400, members: [{ end_at: '2026-07-18T02:14:00Z', routine: 2 }, { end_at: '2026-07-19T10:00:00Z', routine: null }], ...over,
})

afterEach(() => setUnits(DEFAULT_UNITS))

describe('a routine', () => {
  it('is named by the days and the part of the day it ends in', () => {
    expect(routineTitle(routine())).toBe('On weekdays in the evening, about 6.4 km')
    expect(routineTitle(routine({ weekend_pct: 94, hour: 10.6, km_median: 9.6 }))).toBe('On weekends in the morning, about 9.6 km')
    expect(routineTitle(long)).toBe('Any day in the evening, about 279 km')
    expect(whenWord({ weekend_pct: 20 })).toBe('On weekdays')
    expect([0.5, 4.9, 5, 12, 15, 18, 22, 23.9].map(timeWord)).toEqual([
      'at night', 'at night', 'in the morning', 'around midday', 'in the afternoon', 'in the evening', 'at night', 'at night',
    ])
  })

  it('describes its stretches', () => {
    expect(routineLine(routine())).toBe('ending between 16:30 and 21:54 · about 17 minutes of driving · 51 stretches on 23 days · 10% of the distance · 8.0 l/100 km')
    expect(routineLine(routine({ minutes_median: null, l_per_100km: null }))).toBe('ending between 16:30 and 21:54 · 51 stretches on 23 days · 10% of the distance')
  })

  it('follows the reader’s units', () => {
    setUnits({ ...DEFAULT_UNITS, distance: 'mi', consumption: 'mpg-uk' })
    expect(routineTitle(long)).toBe('Any day in the evening, about 173 mi')
    expect(routineLine(long)).toMatch(/about 143 minutes of driving .* 43\.9 mpg \(UK\)$/)
  })

  it('writes hours as a clock, wrapping at midnight', () => {
    expect([18.7, 0, 23.999, 9.25].map(clock)).toEqual(['18:42', '00:00', '00:00', '09:15'])
  })
})

describe('the panel', () => {
  it('has a headline and counts the stretches that fit no routine', () => {
    expect(summaryLine(answer([routine(), long]))).toBe('2 routines hold 63 of the 192 stretches.')
    expect(otherLine(answer([routine(), long]))).toBe('129 stretches fit no routine (400 km).')
  })

  it('says when there is too little or nothing clear', () => {
    expect(summaryLine(answer([], { enough: false, stretches: 20 }))).toBe('Too few stretches to look for routines yet (20 of at least 30).')
    expect(summaryLine(answer([], { clear: false }))).toBe('The stretches do not fall into clear routines.')
    expect(otherLine(answer([], { clear: false }))).toBeNull()
    expect(summaryLine(undefined)).toBeNull()
  })

  it('names the routine of a stretch on the Day page', () => {
    const a = answer([routine(), long])
    expect(routineOf('2026-07-18T02:14:00.000Z', a)).toBe('closest routine: Any day in the evening, about 279 km')
    expect(routineOf('2026-07-19T10:00:00Z', a)).toBeNull()
    expect(routineOf('2026-07-20T10:00:00Z', a)).toBeNull()
  })
})

describe('the wording stays neutral', () => {
  const all = () => [summaryLine(answer([routine(), long])), routineTitle(routine()), routineLine(routine()), otherLine(answer([routine()])), tr(ROUTINES_NOTE, { n: 8, days: 4 })].join(' ')

  it('never names a place or judges the driver', () => {
    expect(all()).not.toMatch(/\b(home|work|office|school|commute|good|bad|better|worse|aggressive|efficient|should)\b/i)
    expect(ROUTINES_NOTE).toMatch(/not a place/)
  })

  it('in Portuguese too', () => {
    const pt = inPortuguese(all)
    expect(pt).not.toBe(all())
    expect(pt).not.toMatch(PT_VERDICT)
    expect(pt).not.toMatch(ENGLISH_LEFT)
  })
})
