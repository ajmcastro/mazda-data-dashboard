import { describe, expect, it } from 'vitest'
import { STALE_AFTER_DAYS, alertsLabel, dataAgeDays, faultsLabel, oilLine, optionLabel, staleNote } from './garage'

const now = Date.parse('2026-07-10T12:00:00Z')

describe('data age', () => {
  it('counts whole days since the newest reading', () => {
    expect(dataAgeDays('2026-07-10T08:00:00Z', now)).toBe(0)
    expect(dataAgeDays('2026-07-08T11:59:00Z', now)).toBe(2)
    expect(dataAgeDays(null, now)).toBeNull()
    expect(dataAgeDays('2026-07-11T00:00:00Z', now)).toBe(0) // a clock a little ahead is not negative
  })
  it('flags only data older than a week, with how old it is', () => {
    expect(staleNote('2026-07-03T12:00:00Z', now)).toBeNull() // exactly a week: still fine
    expect(STALE_AFTER_DAYS).toBe(7)
    expect(staleNote('2026-06-28T12:00:00Z', now)).toBe('last reading 12 days ago: the figures may be out of date')
    expect(staleNote(null, now)).toBeNull()
  })
})

describe('labels', () => {
  it('words the alert and fault counts', () => {
    expect(alertsLabel(0)).toBe('no new alerts')
    expect(alertsLabel(1)).toBe('1 new alert')
    expect(alertsLabel(15)).toBe('15 new alerts')
    expect(faultsLabel(0)).toBe('no faults listed')
    expect(faultsLabel(1)).toBe('1 fault listed')
    expect(faultsLabel(2)).toBe('2 faults listed')
  })
  it("says what the car reports for the oil change, or that it does not", () => {
    expect(oilLine({ oil_remaining_km: 9000 })).toBe('9,000 km left')
    expect(oilLine({ oil_remaining_km: null })).toBe('not reported')
  })
  it('adds the new alerts to a selector entry only when there are some', () => {
    expect(optionLabel('Mazda CX-5', 3)).toBe('Mazda CX-5 · 3 alerts')
    expect(optionLabel('Mazda CX-5', 1)).toBe('Mazda CX-5 · 1 alert')
    expect(optionLabel('Mazda CX-5', 0)).toBe('Mazda CX-5')
    expect(optionLabel('Mazda CX-5', undefined)).toBe('Mazda CX-5') // no answer for that car: nothing to show
    expect(optionLabel('Mazda CX-60', undefined, false)).toBe('Mazda CX-60 (no data yet)')
  })
})
