import { afterEach, describe, expect, it } from 'vitest'
import type { ChangePoints, ConsumptionSegment } from './api/types'
import { tr } from './i18n'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'
import { DEFAULT_UNITS, setUnits } from './units'
import { STEPS_NOTE, mixLine, serviceLine, stepLine, steps, summaryLine } from './steps'

const seg = (from: string, to: string, l: number, km: number, short: number | null = 40): ConsumptionSegment => ({
  from_at: from, to_at: to, stretches: 80, km, l_per_100km: l, short_pct: short,
})
const cp = (segments: ConsumptionSegment[], over: Partial<ChangePoints> = {}): ChangePoints => ({
  min_km: 150, min_stretches: 10, min_step: 0.3, stretch_km: 5, stretches: 160,
  km: segments.reduce((n, s) => n + s.km, 0), enough: true, segments, ...over,
})

const one = cp([
  seg('2026-04-10T07:00:00Z', '2026-06-09T18:00:00Z', 7.9, 2100, 40),
  seg('2026-06-09T18:00:00Z', '2026-07-31T17:00:00Z', 9.18, 2251.3, 55),
])

afterEach(() => setUnits(DEFAULT_UNITS))

describe('a step', () => {
  it('says when and from what level to what, with the distance each side', () => {
    const [s] = steps(one)
    expect(stepLine(s)).toBe('Around 09 Jun 2026 the consumption went from about 7.9 l/100 km to about 9.2 l/100 km (2,100 km before, 2,251 km after).')
  })

  it('follows the reader’s units', () => {
    setUnits({ ...DEFAULT_UNITS, consumption: 'km/l', distance: 'mi' })
    expect(stepLine(steps(one)[0])).toMatch(/from about 12\.7 km\/l to about 10\.9 km\/l \(1,305 mi before/)
  })

  it('gives the mix of short stretches, and nothing when it is unknown', () => {
    expect(mixLine(steps(one)[0], 5)).toBe('Stretches under 5 km: 40% before, 55% after.')
    const unknown = cp([seg('2026-04-10T07:00:00Z', '2026-06-09T18:00:00Z', 7.9, 2100, null), seg('2026-06-09T18:00:00Z', '2026-07-31T17:00:00Z', 9, 2000)])
    expect(mixLine(steps(unknown)[0], 5)).toBeNull()
  })

  it('lists the service-log entries within two weeks', () => {
    const entries = [
      { date: '2026-06-02', kind: 'tires', note: '', odometer_km: null },
      { date: '2026-05-01', kind: 'oil', note: '', odometer_km: null },
    ]
    expect(serviceLine(steps(one)[0], entries)).toBe('In the service log around then: tires on 02 Jun 2026.')
    expect(serviceLine(steps(one)[0], [])).toBeNull()
    expect(serviceLine(steps(one)[0], undefined)).toBeNull()
  })
})

describe('the headline', () => {
  it('counts the steps over all the data', () => {
    expect(summaryLine(one)).toBe('The consumption stepped once over all the data.')
    expect(summaryLine(cp([seg('2026-04-10T07:00:00Z', '2026-07-31T17:00:00Z', 7.9, 4351.3)]))).toBe(
      'No step in consumption stands out over all the data: about 7.9 l/100 km over 4,351 km in 160 stretches.',
    )
    expect(steps(cp([seg('a', 'b', 7, 100)]))).toEqual([])
  })

  it('says when there is too little driving', () => {
    expect(summaryLine(cp([], { enough: false }))).toBe(
      'Too little driving to look for a change in consumption yet (at least 10 stretches and 150 km on each side).',
    )
    expect(summaryLine(undefined)).toBeNull()
  })
})

describe('the wording stays neutral', () => {
  const all = () => [summaryLine(one), stepLine(steps(one)[0]), mixLine(steps(one)[0], 5), tr(STEPS_NOTE, { stretch: '5 km', step: '0.3 l/100 km', n: 10, km: '150 km' })].join(' ')

  it('says when, never why, and never judges', () => {
    expect(all()).not.toMatch(/\b(because|caused?|due to|explains?|reason|better|worse|good|bad|should|driver)\b/i)
    expect(STEPS_NOTE).toMatch(/It says when, not why/)
  })

  it('in Portuguese too', () => {
    const pt = inPortuguese(all)
    expect(pt).not.toBe(all())
    expect(pt).not.toMatch(PT_VERDICT)
    expect(pt).not.toMatch(ENGLISH_LEFT)
  })
})
