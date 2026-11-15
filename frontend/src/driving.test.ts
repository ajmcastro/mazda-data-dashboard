import { afterEach, describe, expect, it } from 'vitest'
import type { DrivingBand, DrivingMonth, DrivingPattern } from './api/types'
import {
  MIN_STRETCHES, bandLabel, describeMix, drivingNotes, expectedFromMix, headline, mixChanges, pct, share, shortShare,
  unclassifiedNote,
} from './driving'
import { DEFAULT_UNITS, setUnits } from './units'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'

afterEach(() => setUnits(DEFAULT_UNITS))

const LIMITS: [string, number, number | null][] = [['under_5', 0, 5], ['5_to_20', 5, 20], ['20_to_100', 20, 100], ['over_100', 100, null]]
/** Four bands from [stretches, km, l/100 km] each. */
const bands = (...rows: [number, number, number | null][]): DrivingBand[] =>
  LIMITS.map(([band, min_km, max_km], i) => {
    const [stretches, km, rate] = rows[i] ?? [0, 0, null]
    return { band, min_km, max_km, stretches, km, fuel_l: rate === null ? 0 : (km * rate) / 100, l_per_100km: rate }
  })
const month = (name: string, rate: number | null, ...rows: [number, number, number | null][]): DrivingMonth => {
  const b = bands(...rows)
  return { month: name, stretches: b.reduce((s, x) => s + x.stretches, 0), km: b.reduce((s, x) => s + x.km, 0), fuel_l: 0, l_per_100km: rate, bands: b }
}
const pattern = (over: Partial<DrivingPattern> = {}): DrivingPattern => ({
  gap_hours: 48, min_km: 20, stretches: 192, km: 3810, fuel_l: 251.1, l_per_100km: 6.59, driving_hours: 60.8, avg_speed_kmh: 62.6,
  unclassified: { stretches: 22, km: 703.4 },
  bands: bands([91, 143.7, 5.72], [86, 846.3, 7.2], [4, 159, 6.59], [11, 2660.9, 6.44]).map((b) => ({ ...b, driving_hours: 1, avg_speed_kmh: 30 })),
  months: [], ...over,
})

describe('bands and shares', () => {
  it('names a band in the reader\'s unit', () => {
    const b = bands()
    expect(b.map(bandLabel)).toEqual(['under 5 km', '5 to 20 km', '20 to 100 km', 'over 100 km'])
    setUnits({ ...DEFAULT_UNITS, distance: 'mi' })
    expect(b.map(bandLabel)).toEqual(['under 3.1 mi', '3.1 to 12.4 mi', '12.4 to 62.1 mi', 'over 62.1 mi'])
  })
  it('gives a share only when there is a whole', () => {
    expect(share(1, 4)).toBe(25)
    expect(share(0, 0)).toBeNull()
    expect(pct(46.6)).toBe('47%')
    expect(pct(null)).toBe('—')
  })
  it('counts the stretches under 20 km as short, by distance', () => {
    expect(shortShare(bands([10, 20, 7], [10, 80, 7], [2, 100, 7], [1, 200, 6]))).toBe(25)
    expect(shortShare(bands())).toBeNull()
  })
})

describe('the headline', () => {
  it('says how many stretches and how many were the shortest', () => {
    expect(headline(pattern())).toBe('192 stretches of driving in this period. 91 of them (47%) were under 5 km, 4% of the distance.')
  })
  it('copes with one stretch, with none under 5 km and with nothing', () => {
    expect(headline(pattern({ stretches: 1, bands: pattern().bands.map((b, i) => ({ ...b, stretches: i === 1 ? 1 : 0 })) }))).toBe(
      '1 stretch of driving in this period.',
    )
    expect(headline(pattern({ stretches: 0 }))).toBe('No driving seen in this period.')
    expect(headline(undefined)).toBeNull()
  })
  it('says which stretches are in no band and why', () => {
    expect(unclassifiedNote(pattern())).toBe(
      '22 stretches (703 km) are in no band: the two reports around each are 2 days or more apart, so they are probably several drives.',
    )
    expect(unclassifiedNote(pattern({ unclassified: { stretches: 1, km: 40 } }))).toContain('1 stretch (40 km) is in no band')
    expect(unclassifiedNote(pattern({ unclassified: { stretches: 0, km: 0 } }))).toBeNull()
  })
})

describe('a month against the one before', () => {
  // September: 20% of the distance short; October: 40%
  const sep = month('2026-09', 6.5, [10, 20, 6.0], [10, 80, 7.5], [0, 0, null], [2, 400, 6.3])
  const oct = month('2026-10', 6.9, [12, 40, 6.0], [14, 160, 7.6], [0, 0, null], [1, 300, 6.4])

  it('is described when the consumption and the short share moved together', () => {
    const [c] = mixChanges([sep, oct])
    expect(c).toMatchObject({ month: '2026-10', previous: '2026-09', now: 6.9, before: 6.5, shortNow: 40, shortBefore: 20 })
    // October's distances at September's consumption of each length
    expect(c.expected).toBeCloseTo((100 * (40 * 0.06 + 160 * 0.075 + 300 * 0.063)) / 500, 6)
    expect(describeMix(c)).toBe(
      "Oct 2026: 6.9 l/100 km, Sept 2026: 6.5. Stretches under 20 km went from 20% to 40% of the distance. With Sept 2026's consumption for each length, Oct 2026's mix alone would give 6.7.",
    )
  })
  it('works the other way round too (fewer short stretches, lower consumption)', () => {
    expect(mixChanges([oct, { ...sep, month: '2026-11' }])).toHaveLength(1)
  })
  it('says nothing when the two moved in opposite directions', () => {
    expect(mixChanges([sep, { ...oct, l_per_100km: 6.1 }])).toEqual([])
  })
  it('says nothing about a small change of either', () => {
    expect(mixChanges([sep, { ...oct, l_per_100km: 6.6 }])).toEqual([])
    const sameMix = month('2026-10', 6.9, [10, 22, 6.0], [10, 85, 7.5], [0, 0, null], [2, 400, 6.3])
    expect(mixChanges([sep, sameMix])).toEqual([])
  })
  it('says nothing about a month with too few stretches or without a consumption', () => {
    const few = month('2026-10', 6.9, [3, 40, 6.0], [4, 160, 7.6], [0, 0, null], [1, 300, 6.4])
    expect(few.bands.reduce((s, b) => s + b.stretches, 0)).toBeLessThan(MIN_STRETCHES)
    expect(mixChanges([sep, few])).toEqual([])
    expect(mixChanges([sep, { ...oct, l_per_100km: null }])).toEqual([])
    expect(mixChanges([sep])).toEqual([])
  })
  it('leaves the mix figure out when a length was not driven the month before', () => {
    const withMiddle = month('2026-10', 6.9, [12, 40, 6.0], [14, 160, 7.6], [2, 60, 6.6], [1, 240, 6.4])
    expect(expectedFromMix(withMiddle, sep)).toBeNull()
    const [c] = mixChanges([sep, withMiddle])
    expect(c.expected).toBeNull()
    expect(describeMix(c)).not.toContain('mix alone')
  })
  it('follows the reader\'s units', () => {
    setUnits({ pressure: 'kPa', consumption: 'km/l', distance: 'mi' })
    const text = describeMix(mixChanges([sep, oct])[0])
    expect(text).toContain('Oct 2026: 14.5 km/l, Sept 2026: 15.4.')
    expect(text).toContain('Stretches under 12.4 mi')
  })
})

describe('the wording', () => {
  it('is about the car\'s use and never a verdict', () => {
    const sep = month('2026-09', 6.5, [10, 20, 6.0], [10, 80, 7.5], [0, 0, null], [2, 400, 6.3])
    const oct = month('2026-10', 6.9, [12, 40, 6.0], [14, 160, 7.6], [0, 0, null], [1, 300, 6.4])
    const text = [headline(pattern()), unclassifiedNote(pattern()), describeMix(mixChanges([sep, oct])[0]), ...drivingNotes(20)].join(' ')
    expect(text).not.toMatch(/\b(bad|good|better|worse|should|too many|too much|waste|wasteful|because|caused by|explains)\b/i)
    const portuguese = inPortuguese(() => [headline(pattern()), unclassifiedNote(pattern()), describeMix(mixChanges([sep, oct])[0]), ...drivingNotes(20)].join(' '))
    expect(portuguese).not.toBe(text)
    expect(portuguese).not.toMatch(PT_VERDICT)
    expect(portuguese).not.toMatch(/explica|demasiad/i)
    expect(portuguese).not.toMatch(ENGLISH_LEFT)
    expect(text).toContain('between two status reports')
    expect(text).toContain('not what caused what')
  })
})
