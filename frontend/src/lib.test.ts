import { describe, expect, it } from 'vitest'
import {
  daysInRange,
  editRange,
  fmtAgo,
  fmtNum,
  parseDay,
  pivotDaily,
  sanitizeRange,
  signalLabel,
  signalValue,
} from './lib'

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

describe('freeze-frame signals', () => {
  it('adds known units and leaves unknown signals raw', () => {
    expect(signalValue('Vehicle_Speed', '12.5')).toBe('12.5\u202fkm/h')
    expect(signalValue('Shift_Position', '3')).toBe('3')
    expect(signalValue('Vehicle_Speed', null)).toBe('—')
  })
  it('makes names readable and caps their length', () => {
    expect(signalLabel('Engine_Coolant_Temperature')).toBe('Engine Coolant Temperature')
    expect(signalLabel('x'.repeat(80))).toHaveLength(58)
  })
})

describe('date range', () => {
  it('accepts only real calendar days', () => {
    expect(parseDay('2026-02-28')).toBe('2026-02-28')
    expect(parseDay('2026-02-30')).toBeUndefined()
    expect(parseDay('2026-13-01')).toBeUndefined()
    expect(parseDay('26-02-01')).toBeUndefined()
    expect(parseDay('')).toBeUndefined()
    expect(parseDay(null)).toBeUndefined()
  })
  it('sanitizes what comes from the address bar', () => {
    expect(sanitizeRange('2026-05-02', '2026-05-01')).toEqual({ from: '2026-05-01', to: '2026-05-02' })
    expect(sanitizeRange('junk', '2026-05-01')).toEqual({ from: undefined, to: '2026-05-01' })
    expect(sanitizeRange(null, null)).toEqual({ from: undefined, to: undefined })
  })
  it('counts days inclusively, across month and year ends', () => {
    expect(daysInRange('2026-06-12', '2026-06-12')).toBe(1)
    expect(daysInRange('2026-06-12', '2026-10-22')).toBe(133)
    expect(daysInRange('2025-12-31', '2026-01-01')).toBe(2)
  })
  it('keeps the bounds ordered while editing', () => {
    const r = { from: '2026-05-10', to: '2026-05-20' }
    expect(editRange(r, 'from', '2026-05-15')).toEqual({ from: '2026-05-15', to: '2026-05-20' })
    expect(editRange(r, 'from', '2026-06-01')).toEqual({ from: '2026-06-01', to: '2026-06-01' })
    expect(editRange(r, 'to', '2026-05-01')).toEqual({ from: '2026-05-01', to: '2026-05-01' })
    expect(editRange(r, 'to', '')).toEqual({ from: '2026-05-10', to: undefined })
  })
})
