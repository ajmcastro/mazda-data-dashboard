import { afterEach, describe, expect, it } from 'vitest'
import type { TireForecast, WheelForecast } from './api/types'
import { carState } from './car'
import { fmtDate } from './lib'
import { forecastBasis, forecastLines, notesByPart, wheelLine, wheelNote } from './tires'
import { DEFAULT_UNITS, setUnits } from './units'

afterEach(() => setUnits(DEFAULT_UNITS))

const w = (over: Partial<WheelForecast> = {}): WheelForecast => ({
  wheel: 'rl', measurements: 14, span_days: 23, current_kpa: 230, last_at: '2026-11-10T13:50:00Z', refilled_at: null,
  enough: true, kpa_per_week: -4, losing: true, below_limit: false, days_left: 53, reaches_limit_on: '2026-12-12', ...over,
})
const quiet = (wheel: string): WheelForecast => w({ wheel, kpa_per_week: 1.3, losing: false, days_left: null, reaches_limit_on: null })
const forecast = (...wheels: WheelForecast[]): TireForecast => ({ limit_kpa: 200, window_days: 30, min_measurements: 8, min_span_days: 10, wheels })

describe('a wheel in words', () => {
  it('gives the rate against the other three, the date "at this rate" and what it is based on', () => {
    expect(wheelLine(w(), 200)).toBe(
      `Rear left: losing about 4.0 kPa a week against the other three; at this rate it reaches 200 kPa around ${fmtDate('2026-12-12')}. Based on 14 measurements over 23 days.`,
    )
  })
  it('says nothing about a wheel that is not losing pressure, or has too little data', () => {
    expect(wheelLine(quiet('fl'), 200)).toBeNull()
    expect(wheelLine(w({ enough: false, losing: false, kpa_per_week: null }), 200)).toBeNull()
    expect(wheelNote(quiet('fl'), 200)).toBeNull()
    expect(wheelNote(undefined, 200)).toBeNull()
  })
  it('says so when the wheel is already under the limit, or far from it', () => {
    const low = w({ current_kpa: 180, kpa_per_week: -15.1, below_limit: true, days_left: null, reaches_limit_on: null })
    expect(wheelLine(low, 200)).toContain('losing about 15 kPa a week against the other three; it reads 180 kPa, already at or under your 200 kPa limit.')
    expect(wheelLine(w({ days_left: null, reaches_limit_on: null }), 200)).toContain('at this rate it is more than a year from 200 kPa')
  })
  it('mentions a refill, because the series starts there', () => {
    expect(wheelLine(w({ refilled_at: '2026-10-20T09:00:00Z', measurements: 9, span_days: 11 }), 200)).toContain(
      `Based on 9 measurements over 11 days, since it was refilled on ${fmtDate('2026-10-20T09:00:00Z')}.`,
    )
  })
  it('follows the reader\'s pressure unit', () => {
    setUnits({ ...DEFAULT_UNITS, pressure: 'psi' })
    expect(wheelLine(w(), 200)).toContain('losing about 0.6 psi a week')
    expect(wheelLine(w(), 200)).toContain('reaches 29.0 psi around')
    setUnits({ ...DEFAULT_UNITS, pressure: 'bar' })
    expect(wheelLine(w(), 200)).toContain('losing about 0.04 bar a week')
  })
})

describe('the forecast as a whole', () => {
  const d = forecast(quiet('fl'), quiet('fr'), w(), quiet('rr'))
  it('lists only the wheels losing pressure', () => {
    expect(forecastLines(d)).toHaveLength(1)
    expect(forecastLines(d)[0]).toMatch(/^Rear left:/)
    expect(forecastLines(forecast(quiet('fl'), quiet('fr'), quiet('rl'), quiet('rr')))).toEqual([])
    expect(forecastLines(undefined)).toEqual([])
    expect(forecastLines(forecast())).toEqual([])
  })
  it('says what it compares and what it needs, and never promises', () => {
    const text = [forecastBasis(d), ...forecastLines(d)].join(' ')
    expect(text).toContain('the mean of the other three')
    expect(text).toContain('8 measurements over 10 days')
    expect(text).toContain('at this rate')
    expect(text).not.toMatch(/\b(will|puncture|unsafe|danger|must)\b/i)
  })
  it('puts a note on the wheel in the car view without changing its state', () => {
    expect(notesByPart(d)).toEqual({ wheel_rl: `losing about 4.0 kPa a week against the other three; 200 kPa around ${fmtDate('2026-12-12')} at this rate` })
    expect(notesByPart(undefined)).toEqual({})
    const overview = { status: { at: '2026-11-10T13:50:00Z', tire_fl_kpa: 240, tire_fr_kpa: 240, tire_rl_kpa: 230, tire_rr_kpa: 240 } } as never
    const plain = carState(overview, undefined, undefined, undefined)
    const noted = carState(overview, undefined, undefined, undefined, notesByPart(d))
    const [before, after] = [plain, noted].map((c) => c.parts.find((p) => p.id === 'wheel_rl')!)
    expect(after.state).toBe(before.state)
    expect(after.notes).toEqual([...before.notes, notesByPart(d).wheel_rl])
    expect(noted.parts.find((p) => p.id === 'wheel_fl')!.notes).toEqual(plain.parts.find((p) => p.id === 'wheel_fl')!.notes)
  })
})
