import { describe, expect, it } from 'vitest'
import { FUEL_CAUTION, STALE_AFTER_DAYS, alertsLabel, costBlock, dataAgeDays, faultsLabel, fuelBlock, oilLine, optionLabel, staleNote } from './garage'

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

describe('fuel and cost of the 30 days', () => {
  const full = { fuel_l_30d: 73.6, l_per_100km_30d: 7.24, fuel_cost_30d: 133.14, cost_per_100km_30d: 13.1, currency: 'EUR' }

  it('shows the litres and the average consumption, as estimates', () => {
    expect(fuelBlock(full)).toEqual({ value: '74 L', sub: '7.24 l/100 km on average (estimated)' })
  })
  it('shows the total cost and the average per 100 km in the car’s own currency, as estimates', () => {
    expect(costBlock(full)).toEqual({ value: '133 EUR', sub: '13.10 EUR per 100 km (estimated)' })
    expect(costBlock({ ...full, currency: 'GBP' })?.value).toBe('133 GBP')
  })
  it('has no cost without a fuel price, but keeps the litres', () => {
    const noPrice = { fuel_l_30d: 73.6, l_per_100km_30d: 7.24, fuel_cost_30d: null, cost_per_100km_30d: null, currency: null }
    expect(costBlock(noPrice)).toBeNull()
    expect(fuelBlock(noPrice)).not.toBeNull()
    expect(costBlock({ ...full, currency: null })).toBeNull() // an amount without a currency is never shown
  })
  it('has neither when the car has no consumption in the window', () => {
    const none = { fuel_l_30d: null, l_per_100km_30d: null, fuel_cost_30d: null, cost_per_100km_30d: null, currency: null }
    expect(fuelBlock(none)).toBeNull()
    expect(costBlock(none)).toBeNull()
    expect(fuelBlock({ ...none, l_per_100km_30d: 7 })).toBeNull() // litres missing: not half a figure
  })
  it('says the figures are estimates and that averages between cars need care', () => {
    expect(FUEL_CAUTION).toMatch(/estimates/)
    expect(FUEL_CAUTION).toMatch(/not what you paid/)
    expect(FUEL_CAUTION).toMatch(/plug-in hybrid/)
    expect(FUEL_CAUTION).not.toMatch(/better|worse/i)
  })
})

