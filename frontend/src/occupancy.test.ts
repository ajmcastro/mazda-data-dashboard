import { describe, expect, it } from 'vitest'
import type { Occupancy } from './api/types'
import { MIN_READINGS, OCCUPANCY_NOTE, monthBars, pct, shares, summaryLine } from './occupancy'

const o = (over: Partial<Occupancy> = {}): Occupancy => ({
  available: true, readings: 258, belted_readings: 149, passenger_readings: 24, rear_readings: 12,
  driver_only_readings: 117,
  months: [
    { month: '2026-06', belted_readings: 20, passenger_readings: 4, rear_readings: 0 },
    { month: '2026-07', belted_readings: 3, passenger_readings: 3, rear_readings: 1 },
  ],
  ...over,
})

describe('shares', () => {
  it('are of the belted snapshots and can overlap', () => {
    const s = shares(o())
    expect(s.map((x) => [x.key, x.pct])).toEqual([['driver_only', 79], ['passenger', 16], ['rear', 8]])
  })
  it('are absent when the car does not send the belts', () => {
    expect(shares(o({ available: false, readings: 0, belted_readings: 0, months: [] }))).toEqual([])
    expect(shares(undefined)).toEqual([])
  })
  it('give null, not zero, for no belted snapshots', () => {
    expect(pct(0, 0)).toBeNull()
    expect(pct(1, 3)).toBe(33)
  })
})

describe('months', () => {
  it('mark a month with too few belted snapshots', () => {
    const [june, july] = monthBars(o())
    expect(june).toMatchObject({ passengerPct: 20, rearPct: 0, few: false })
    expect(july).toMatchObject({ passengerPct: 100, belted: 3, few: true })
    expect(MIN_READINGS).toBe(5)
  })
})

describe('wording', () => {
  it('says what was counted, neutrally', () => {
    expect(summaryLine(o())).toBe(
      'In 149 status snapshots with the driver’s belt buckled: driver only in 79%, a front passenger belted in 16%.',
    )
    expect(summaryLine(o({ available: false }))).toBeNull()
    expect(OCCUPANCY_NOTE).toMatch(/not over trips/)
    expect(OCCUPANCY_NOTE).toMatch(/seat belts only/)
  })
})
