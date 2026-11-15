import { describe, expect, it } from 'vitest'
import type { Occupancy } from './api/types'
import { MIN_READINGS, OCCUPANCY_NOTE, monthBars, pct, shares, summaryLine, SEATS_NOTE, seatShade, seats } from './occupancy'

const o = (over: Partial<Occupancy> = {}): Occupancy => ({
  available: true, readings: 258, belted_readings: 149, passenger_readings: 24, rear_readings: 12,
  driver_only_readings: 117, rear_left_readings: 9, rear_right_readings: 5,
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

describe('the seats (M57)', () => {
  it('gives each seat its own share of the snapshots with the driver belted', () => {
    const s = seats(o())
    expect(s.map((x) => [x.id, x.pct, x.readings])).toEqual([['driver', 100, 149], ['passenger', 16, 24], ['rear_left', 6, 9], ['rear_right', 3, 5]])
  })
  it('puts the driver on the side the model says and leaves the rear seats where the car has them', () => {
    const place = (side: 'left' | 'right') => Object.fromEntries(seats(o(), side).map((x) => [x.id, [x.column, x.row]]))
    expect(place('left')).toEqual({ driver: [0, 0], passenger: [1, 0], rear_left: [0, 1], rear_right: [1, 1] })
    expect(place('right')).toEqual({ driver: [1, 0], passenger: [0, 0], rear_left: [0, 1], rear_right: [1, 1] })
  })
  it('draws nothing for a car that sends no belts, and copes with an answer made before the seats were counted', () => {
    expect(seats({ ...o(), available: false })).toEqual([])
    expect(seats(undefined)).toEqual([])
    expect(seats({ ...o(), belted_readings: 0 })).toEqual([])
    const old = { ...o(), rear_left_readings: undefined, rear_right_readings: undefined } as never
    expect(seats(old).slice(2).map((x) => x.pct)).toEqual([0, 0])
  })
  it('shades by the share, never fully empty, and says what is not seen', () => {
    expect(seatShade({ pct: 100 })).toBe(1)
    expect(seatShade({ pct: 0 })).toBeCloseTo(0.08)
    expect(seatShade({ pct: null })).toBeCloseTo(0.08)
    expect(seatShade({ pct: 50 })).toBeCloseTo(0.54)
    expect(SEATS_NOTE).toContain('not seen')
  })
})
