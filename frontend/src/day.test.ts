import { afterEach, describe as group, expect, it } from 'vitest'
import type { Day, DayEntry } from './api/types'
import { KIND_LABEL, addDays, dayShort, dayTitle, describe, isDay, placedAt, summary, timeOn, when } from './day'
import { fmtNum } from './lib'
import { DEFAULT_UNITS, setUnits } from './units'

afterEach(() => setUnits(DEFAULT_UNITS))

const e = (kind: string, over: Partial<DayEntry> = {}): DayEntry => ({ kind, local: '2026-06-27 12:30', ...over }) as DayEntry
const DAY = '2026-06-27'

group('days and times', () => {
  it('names a day without a time zone moving it', () => {
    expect(dayTitle(DAY)).toBe('Saturday, 27 June 2026')
    expect(dayShort(DAY)).toBe('27 Jun')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30') // the day the clocks change
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(isDay(DAY)).toBe(true)
    expect([isDay('2026-6-1'), isDay('x'), isDay(null), isDay('')]).toEqual([false, false, false, false])
  })
  it('shows the car\'s local time, with the date only when it is another day', () => {
    expect(timeOn('2026-06-27 12:30', DAY)).toBe('12:30')
    expect(timeOn('2026-06-26 18:29', DAY)).toBe('26 Jun 18:29')
    expect(timeOn(null, DAY)).toBe('—')
  })
  it('says "between" for what is only known between two reports', () => {
    const drive = e('drive', { local: '2026-06-26 18:29', local_until: '2026-06-27 12:30' })
    expect(when(drive, DAY)).toBe('between 26 Jun 18:29 and 12:30')
    expect(placedAt(drive, DAY)).toBe('12:30')
    expect(when(e('fill_up', { local: '2026-06-27 08:00', local_until: '2026-06-27 12:30' }), DAY)).toBe('between 08:00 and 12:30')
    expect(when(e('warning', { local: '2026-06-27 12:06', local_until: '2026-06-27 12:15' }), DAY)).toBe('12:06 – 12:15')
    expect(when(e('warning', { local: '2026-06-27 12:06', local_until: '2026-06-27 12:06' }), DAY)).toBe('12:06')
    expect(when(e('status'), DAY)).toBe('12:30')
  })
})

group('an entry in words', () => {
  it('describes a drive and a status report in the reader\'s units', () => {
    expect(describe(e('drive', { km: 54.4, l_per_100km: 6.1 }))).toEqual({
      title: 'Drove 54.4 km', detail: '6.1 l/100 km, between two status reports', to: '/trends',
    })
    expect(describe(e('drive', { km: 2 })).detail).toBe('between two status reports')
    expect(describe(e('status', { odometer_km: 4804.9, fuel_level_pct: 99.3, d_fuel_pct: 81.3, tire_min_kpa: 190 }))).toEqual({
      title: 'Status report', detail: `odometer ${fmtNum(4805)} km · fuel 99 % (+81.3) · lowest tire 190 kPa`, to: '/status',
    })
    expect(describe(e('status', { fuel_level_pct: 31.6, d_fuel_pct: -2.8 })).detail).toBe('fuel 32 % (−2.8)')
    expect(describe(e('status')).detail).toBeNull()
    setUnits({ pressure: 'psi', consumption: 'mpg-uk', distance: 'mi' })
    expect(describe(e('drive', { km: 54.4, l_per_100km: 6.1 })).title).toBe('Drove 33.8 mi')
    expect(describe(e('status', { tire_min_kpa: 190 })).detail).toBe('lowest tire 27.6 psi')
  })
  it('describes doors, warnings, read-outs and the rest', () => {
    expect(describe(e('doors', { text: 'driver door, trunk' })).title).toBe('Open: driver door, trunk')
    expect(describe(e('doors', { text: '' })).title).toBe('Everything closed again')
    expect(describe(e('warning', { code: '$201', n: 4, title: 'Unknown warning $201' }))).toEqual({
      title: 'Warning $201 × 4', detail: 'Unknown warning $201', to: '/warnings', params: { code: '$201' },
    })
    expect(describe(e('warning', { code: '$2B7', n: 1 })).title).toBe('Warning $2B7')
    expect(describe(e('readout', { n: 2, text: 'P0562, U2701' }))).toMatchObject({ title: 'Fault read-out: 2 faults', detail: 'P0562, U2701', to: '/faults' })
    expect(describe(e('readout', { n: 1 })).title).toBe('Fault read-out: 1 fault')
    expect(describe(e('readout', { n: 0 })).title).toBe('Fault read-out: no faults')
    expect(describe(e('alarm', { text: 'status 5, reason 5' }))).toMatchObject({ title: 'Alarm report', detail: 'status 5, reason 5' })
    expect(describe(e('diag', { ref: 'abc', odometer_km: 4800 }))).toMatchObject({ to: '/diagnostics', params: { report: 'abc' } })
    expect(describe(e('alert', { title: 'Low tire pressure', text: 'below your limit' }))).toMatchObject({ title: 'Alert: Low tire pressure', to: '/alerts' })
    expect(describe(e('service', { code: 'oil_change', text: 'Oil and filter', odometer_km: 4310 }))).toEqual({
      title: 'Service log: oil change', detail: `Oil and filter · odometer ${fmtNum(4310)} km`, to: '/status',
    })
    expect(placedAt(e('service', { local: null }), DAY)).toBe('that day')
    expect(when(e('service', { local: null }), DAY)).toBe('that day')
    expect(describe(e('something new', { text: 'x' }))).toEqual({ title: 'something new', detail: 'x', to: null })
  })
  it('words a fill-up as an estimate between two reports, in litres or points', () => {
    expect(describe(e('fill_up', { litres: 45.5, fuel_level_pct: 99.3 }))).toMatchObject({
      title: 'Fill-up: about 45.5 l', detail: 'fuel level 99 % after it, between two status reports',
    })
    expect(describe(e('fill_up', { d_fuel_pct: 81.3, doubtful: true })).title).toBe('Fill-up: 81 points (doubtful)')
  })
  it('has a label for every kind it describes', () => {
    for (const kind of ['drive', 'status', 'doors', 'warning', 'readout', 'alarm', 'fill_up', 'diag', 'alert', 'service']) {
      expect(KIND_LABEL[kind]).toBeTruthy()
      expect(describe(e(kind)).to).not.toBeNull()
    }
  })
})

group('the day in one line', () => {
  const day = (entries: DayEntry[]): Day => ({ date: DAY, time_zone: 'Europe/Lisbon', entries }) as Day
  it('adds up what was driven and counts the rest', () => {
    const d = day([
      e('drive', { km: 20.5 }), e('drive', { km: 23 }), e('status'), e('status'),
      e('warning', { code: '$201', n: 10 }), e('warning', { code: '$2B7', n: 1 }), e('alarm'), e('alarm'), e('alert'), e('fill_up'),
    ])
    expect(summary(d)).toBe('43.5 km driven · 11 warning events (2 codes) · 2 status reports · 1 fill-up · 2 alarm reports · 1 alert')
  })
  it('is silent about a day with nothing', () => {
    expect(summary(day([]))).toBeNull()
    expect(summary(undefined)).toBeNull()
    expect(summary(day([e('warning', { code: '$1', n: 1 })]))).toBe('1 warning event (1 code)')
  })
})
