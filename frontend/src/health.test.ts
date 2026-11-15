import { describe, expect, it } from 'vitest'
import type { DataHealth } from './api/types'
import { HEALTH_NOTE, KINDS, coverageBar, coverageLine, gapLength, gapsNote, invalidLine, kindLabel, share, usualLine } from './health'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'
import { tr } from './i18n'

const h = (over: Partial<DataHealth> = {}): DataHealth => ({
  has_data: true, range_from: '2026-06-12', range_to: '2026-11-10', days_in_range: 152, snapshots: 240, days_with_status: 63,
  gap_threshold_hours: 48, gaps_total: 3, longest_gap_hours: 262.2, median_gap_hours: 1.6,
  signals_checked: 37, readings_checked: 50000, invalid_readings: 797,
  kinds: [], gaps: [{ from_at: '2026-07-01T10:00:00Z', to_at: '2026-07-12T08:12:00Z', hours: 262.2 }],
  invalid: [{ source: 'vis', signal: 'drstatdrv', readings: 197, invalid: 20, pct: 10.2 }],
  ...over,
})

describe('kinds', () => {
  it('names every kind the API lists, and falls back to the raw name', () => {
    for (const kind of ['war', 'dtc-h', 'dtc-d', 'dtc-ssr', 'rts', 'vis', 'alt', 'diag']) {
      expect(KINDS[kind].label.length).toBeGreaterThan(3)
      expect(KINDS[kind].file.length).toBeGreaterThan(3)
    }
    expect(kindLabel('rts')).toBe('Status reports')
    expect(kindLabel('xyz')).toBe('xyz')
  })
})

describe('lengths and shares', () => {
  it('gives a silence in hours under two days and in days from there', () => {
    expect(gapLength(1.6)).toBe('1.6 h')
    expect(gapLength(47.9)).toBe('47.9 h')
    expect(gapLength(48)).toBe('2.0 days')
    expect(gapLength(262.2)).toBe('10.9 days')
    expect(gapLength(null)).toBe('—')
  })
  it('gives a share to one decimal, and none of nothing', () => {
    expect(share(797, 50000)).toBe(1.6)
    expect(share(1, 3)).toBe(33.3)
    expect(share(0, 0)).toBeNull()
  })
})

describe('coverageBar', () => {
  const range = { range_from: '2026-06-01', range_to: '2026-06-10' } // ten days
  it('places a kind between its first and last record', () => {
    expect(coverageBar({ first_at: '2026-06-01T00:00:00Z', last_at: '2026-06-11T00:00:00Z' }, range)).toEqual({ left: 0, width: 100 })
    const half = coverageBar({ first_at: '2026-06-06T00:00:00Z', last_at: '2026-06-11T00:00:00Z' }, range)!
    expect(half.left).toBeCloseTo(50, 6)
    expect(half.width).toBeCloseTo(50, 6)
  })
  it('keeps a single record visible and never leaves the strip', () => {
    const one = coverageBar({ first_at: '2026-06-03T12:00:00Z', last_at: '2026-06-03T12:00:00Z' }, range)!
    expect(one.width).toBe(1)
    const outside = coverageBar({ first_at: '2026-05-01T00:00:00Z', last_at: '2026-07-01T00:00:00Z' }, range)!
    expect(outside).toEqual({ left: 0, width: 100 })
    expect(coverageBar({ first_at: '2026-06-11T00:00:00Z', last_at: '2026-06-11T00:00:00Z' }, range)!.left).toBeLessThanOrEqual(99)
  })
  it('has nothing to draw for a kind without records or without known days', () => {
    expect(coverageBar({ first_at: null, last_at: null }, range)).toBeNull()
    expect(coverageBar({ first_at: '2026-06-03T12:00:00Z', last_at: '2026-06-03T12:00:00Z' }, { range_from: null, range_to: null })).toBeNull()
  })
})

describe('the sentences', () => {
  it('say how many days have a status report and how long the longest silence was', () => {
    expect(coverageLine(h())).toBe('Status reports cover 63 of 152 days; the longest silence between two of them was 10.9 days.')
    expect(coverageLine(h({ days_in_range: 1, days_with_status: 1, longest_gap_hours: null }))).toBe('Status reports cover 1 of 1 day.')
  })
  it('say so when there is no data, or no status report', () => {
    expect(coverageLine(h({ has_data: false, snapshots: 0 }))).toBe('No data in this period.')
    expect(coverageLine(h({ snapshots: 0, days_with_status: 0 }))).toContain('no status report')
    expect(coverageLine(undefined)).toBeNull()
  })
  it('say how far apart the reports usually are, and what that limits', () => {
    expect(usualLine(h())).toContain('within 1.6 h of the one before')
    expect(usualLine(h())).toContain('between two reports')
    expect(usualLine(h({ median_gap_hours: null }))).toBeNull()
  })
  it('say how many silences are listed, or that there is none', () => {
    expect(gapsNote(h())).toBe('The 1 longest of 3 are listed.')
    expect(gapsNote(h({ gaps_total: 1 }))).toBeNull()
    expect(gapsNote(h({ gaps_total: 0, gaps: [] }))).toBe('No silence of 48 hours or more in this period.')
  })
  it('say what the car flagged Invalid and that it is never used', () => {
    expect(invalidLine(h())).toBe(
      'The car flagged 797 of 50,000 readings as Invalid (1.6%), in 1 of 37 signals. An Invalid reading is never used: it shows as unknown, not as a value.',
    )
    expect(invalidLine(h({ invalid_readings: 2, readings_checked: 50000 }))).toContain('(under 0.1%)')
    expect(invalidLine(h({ invalid_readings: 0, invalid: [] }))).toBe('None of the 50,000 readings the dashboard uses was flagged Invalid by the car.')
    expect(invalidLine(h({ readings_checked: 0 }))).toBeNull()
  })
  it('never pass a verdict on the car', () => {
    const all = [coverageLine(h()), usualLine(h()), gapsNote(h()), invalidLine(h()), HEALTH_NOTE].join(' ')
    expect(all).not.toMatch(/\b(fault|broken|problem|bad|good|healthy|unhealthy|wrong|defect)/i)
    const portuguese = inPortuguese(() => [coverageLine(h()), usualLine(h()), gapsNote(h()), invalidLine(h()), tr(HEALTH_NOTE)].join(' '))
    expect(portuguese).not.toBe(all)
    expect(portuguese).not.toMatch(PT_VERDICT)
    expect(portuguese).not.toMatch(/avaria|problema/i)
    expect(portuguese).not.toMatch(ENGLISH_LEFT)
    expect(HEALTH_NOTE).toContain('not about the car')
  })
})
