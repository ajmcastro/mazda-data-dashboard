import { describe, expect, it } from 'vitest'
import { fmtAgo, fmtNum, pivotDaily } from './lib'

describe('fmtNum', () => {
  it('formats with digits and unit', () => {
    expect(fmtNum(6243, 0, 'km')).toBe('6,243 km')
    expect(fmtNum(7.316, 1)).toBe('7.3')
  })
  it('shows a dash for missing values', () => {
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(undefined)).toBe('—')
    expect(fmtNum(Number.NaN)).toBe('—')
  })
})

describe('fmtAgo', () => {
  const now = Date.parse('2026-10-22T12:00:00Z')
  it('picks a sensible unit', () => {
    expect(fmtAgo('2026-10-22T11:59:30Z', now)).toBe('just now')
    expect(fmtAgo('2026-10-22T11:15:00Z', now)).toBe('45 min ago')
    expect(fmtAgo('2026-10-22T06:00:00Z', now)).toBe('6 h ago')
    expect(fmtAgo('2026-10-12T12:00:00Z', now)).toBe('10 days ago')
  })
})

describe('pivotDaily', () => {
  const rows = [
    { day: '2026-06-03', code: '$A', events: 2 },
    { day: '2026-06-01', code: '$A', events: 1 },
    { day: '2026-06-01', code: '$B', events: 5 },
    { day: '2026-06-01', code: '$C', events: 9 },
  ]
  it('builds one row per day for the chosen codes only', () => {
    const out = pivotDaily(rows, ['$A', '$B'])
    expect(out[0]).toEqual({ day: '2026-06-01', '$A': 1, '$B': 5 })
  })
  it('fills days without events with zeros', () => {
    const out = pivotDaily(rows, ['$A', '$B'])
    expect(out.map((r) => r.day)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
    expect(out[1]).toEqual({ day: '2026-06-02', '$A': 0, '$B': 0 })
  })
  it('returns nothing when no chosen code has events', () => {
    expect(pivotDaily(rows, ['$Z'])).toEqual([])
  })
})
