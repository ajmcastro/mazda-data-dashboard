import { describe, expect, it } from 'vitest'
import {
  addDays,
  carWarningHeadline,
  daysInRange,
  editRange,
  fmtAgo,
  fmtNum,
  matchPreset,
  oilTile,
  parseDay,
  pickReport,
  pivotDaily,
  reportLabel,
  resolvePreset,
  restoreRange,
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

describe('quick ranges', () => {
  const first = '2026-03-01'
  const last = '2026-10-22'

  it('does calendar arithmetic across month, year and leap-day boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(addDays('2026-10-22', -29)).toBe('2026-09-23')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30') // across a clock change
  })

  it('counts back from the latest data day, both ends included', () => {
    expect(resolvePreset('30d', first, last)).toEqual({ from: '2026-09-23', to: last })
    expect(daysInRange('2026-09-23', last)).toBe(30)
    expect(resolvePreset('week', first, last)).toEqual({ from: '2026-10-16', to: last })
    expect(resolvePreset('fortnight', first, last)).toEqual({ from: '2026-10-09', to: last })
    expect(resolvePreset('60d', first, last)).toEqual({ from: '2026-08-24', to: last })
    expect(resolvePreset('90d', first, last)).toEqual({ from: '2026-07-25', to: last })
  })

  it('works when the window crosses a month or year end', () => {
    expect(resolvePreset('30d', '2025-01-01', '2026-01-10')).toEqual({ from: '2025-12-12', to: '2026-01-10' })
    expect(resolvePreset('week', '2026-01-01', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' })
  })

  it('never starts before the first day with data', () => {
    expect(resolvePreset('90d', '2026-10-01', last)).toEqual({ from: '2026-10-01', to: last })
    expect(resolvePreset('week', '2026-10-20', last)).toEqual({ from: '2026-10-20', to: last })
  })

  it('treats All time as no bounds', () => {
    expect(resolvePreset('all', first, last)).toEqual({})
  })

  it('recognises which preset a range is', () => {
    expect(matchPreset({}, first, last)).toBe('all')
    expect(matchPreset({ from: '2026-09-23', to: last }, first, last)).toBe('30d')
    expect(matchPreset({ from: '2026-09-24', to: last }, first, last)).toBeUndefined() // custom
    expect(matchPreset({ from: '2026-09-23' }, first, last)).toBeUndefined() // open end
    expect(matchPreset({ from: '2026-09-23', to: last })).toBeUndefined() // span not loaded
  })

  it('picks the shortest preset when the data is shorter than several of them', () => {
    // five days of data: every preset resolves to the whole span
    const short = resolvePreset('90d', '2026-10-18', last)
    expect(matchPreset(short, '2026-10-18', last)).toBe('week')
  })

  it('restores only a saved rolling preset, never all-time, custom or junk', () => {
    expect(restoreRange('30d', first, last)).toEqual({ from: '2026-09-23', to: last })
    expect(restoreRange('all', first, last)).toBeUndefined()
    expect(restoreRange('custom', first, last)).toBeUndefined()
    expect(restoreRange('nonsense', first, last)).toBeUndefined()
    expect(restoreRange(null, first, last)).toBeUndefined()
    expect(restoreRange('30d', null, null)).toBeUndefined() // no data yet
  })
})

describe('diagnostic report selection', () => {
  const list = [{ report_id: 'new' }, { report_id: 'mid' }, { report_id: 'old' }]
  it('shows the newest report unless another one is asked for', () => {
    expect(pickReport(list, null)).toEqual({ report: list[0], notFound: false })
    expect(pickReport(list, undefined).report?.report_id).toBe('new')
    expect(pickReport(list, 'old')).toEqual({ report: list[2], notFound: false })
  })
  it('falls back to the newest and says so when the requested report does not exist', () => {
    expect(pickReport(list, 'gone')).toEqual({ report: list[0], notFound: true })
  })
  it('copes with no reports at all', () => {
    expect(pickReport([], null)).toEqual({ report: undefined, notFound: false })
    expect(pickReport([], 'x')).toEqual({ report: undefined, notFound: false })
  })
  it('names a report by date, odometer and file', () => {
    const label = reportLabel({ taken_at: '2026-10-15T08:56:59Z', odometer_km: 5781, source_file: 'dump.txt' })
    expect(label).toContain('2026')
    expect(label).toContain('5,781\u202fkm')
    expect(label.endsWith('dump.txt')).toBe(true)
    expect(reportLabel({ taken_at: null, odometer_km: null, source_file: 'x.txt' })).toBe('unknown date · — · x.txt')
  })
})

describe('oilTile', () => {
  const base = {
    has_data: true,
    remaining_km: 9000,
    read_at: '2026-10-04T07:50:28Z',
    odometer_km: 5306.7,
    km_since_reading: 0,
    interval_started_at: '2026-06-12T23:04:08Z',
    intervals: 1,
    steps: [],
  }

  it('says what the car reported, with its odometer and the coarse steps', () => {
    const t = oilTile(base)!
    expect(t.value).toBe('9,000')
    expect(t.soon).toBe(false)
    expect(t.sub).toContain('at 5,307 km')
    expect(t.sub).toContain('steps of 1,000 km')
    expect(t.sub).not.toContain('driven since')
  })

  it('mentions the distance driven since the reading once it is noticeable', () => {
    expect(oilTile({ ...base, km_since_reading: 49 })!.sub).not.toContain('driven since')
    expect(oilTile({ ...base, km_since_reading: 1234 })!.sub).toContain('1,234 km driven since')
  })

  it('is flagged as due soon at 1,000 km or less', () => {
    expect(oilTile({ ...base, remaining_km: 1000 })!.soon).toBe(true)
    expect(oilTile({ ...base, remaining_km: 2000 })!.soon).toBe(false)
  })

  it('shows nothing without data', () => {
    expect(oilTile(undefined)).toBeNull()
    expect(oilTile({ ...base, has_data: false, remaining_km: null })).toBeNull()
  })
})

describe('carWarningHeadline', () => {
  const flag = (label: string, on: boolean) => ({
    flag: label,
    label,
    is_on: on,
    value: on ? 1 : 0,
    last_read_at: '2026-06-30T10:00:00Z',
    readings: 10,
    episodes: on ? 1 : 0,
    since: on ? '2026-06-20T09:00:00Z' : null,
  })

  it('is null while everything is clear or there is no data', () => {
    expect(carWarningHeadline(undefined)).toBeNull()
    expect(carWarningHeadline([flag('oil level', false), flag('door open', false)])).toBeNull()
  })

  it('names the single flag that is on', () => {
    expect(carWarningHeadline([flag('oil level', false), flag('tire pressure, rear left', true)])).toBe(
      'The car reports a warning: tire pressure, rear left',
    )
  })

  it('counts and lists several', () => {
    expect(carWarningHeadline([flag('oil level', true), flag('door open', true)])).toBe(
      'The car reports 2 warnings: oil level; door open',
    )
  })
})
