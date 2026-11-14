import { afterEach, describe, expect, it } from 'vitest'
import type { Refuel, Refuels } from './api/types'
import { fmtDate, fmtDateTime, fmtNum } from './lib'
import { REFUEL_NOTES, amount, between, doubt, lastFillUp, levels, missingSetting, paidCell, sincePrevious, summaryLine } from './refuels'
import { DEFAULT_UNITS, setUnits } from './units'

afterEach(() => setUnits(DEFAULT_UNITS))

const r = (over: Partial<Refuel> = {}): Refuel => ({
  before_at: '2026-06-05T17:53:07Z', after_at: '2026-06-06T15:44:55Z', level_before: 25, level_after: 98, points: 73,
  gap_hours: 21.9, odometer_km: 4106.2, doubtful: false, litres: 40.9, km_since_previous: 578.8,
  used_since_previous_l: 36.3, l_per_100km_since_previous: 6.28, est_cost: 73.99, paid: null, paid_litres: null, payments: 0,
  ...over,
})
const d = (over: Partial<Refuels> = {}): Refuels => ({
  tank_litres: 56, min_points: 15, currency: 'EUR', fill_ups: 7, doubtful: 0, litres: 297.8, est_cost: 523.48,
  paid: 422.98, paid_fill_ups: 5, refuels: [r()], unmatched: [], ...over,
})

describe('a fill-up in words', () => {
  it('says it happened between two reports, never at a moment', () => {
    expect(between(r())).toBe(`between ${fmtDateTime('2026-06-05T17:53:07Z')} and ${fmtDateTime('2026-06-06T15:44:55Z')}`)
  })
  it('shows the levels, and the litres as "about", or the points without a tank size', () => {
    expect(levels(r())).toBe('25 → 98 %')
    expect(amount(r())).toBe('about 40.9 l')
    expect(amount(r({ litres: null }))).toBe('73 points')
  })
  it('shows what was used since the previous one, in the reader\'s units', () => {
    expect(sincePrevious(r())).toBe(`${fmtNum(579)} km · 6.3 l/100 km`)
    expect(sincePrevious(r({ l_per_100km_since_previous: null }))).toBe(`${fmtNum(579)} km`)
    expect(sincePrevious(r({ km_since_previous: null }))).toBe('—')
    setUnits({ pressure: 'kPa', consumption: 'km/l', distance: 'mi' })
    expect(sincePrevious(r())).toBe(`${fmtNum(360)} mi · 15.9 km/l`)
  })
  it('says why one is doubtful', () => {
    expect(doubt(r(), 15)).toBeNull()
    expect(doubt(r({ doubtful: true, points: 7 }), 15)).toBe('a rise of 7 points, under 15: it may not be a fill-up')
    expect(doubt(r({ doubtful: true, gap_hours: 262.2 }), 15)).toBe('seen across 10.9 days without a report: more may have gone in')
  })
  it('shows what was noted as paid, apart from the estimate', () => {
    expect(paidCell(r(), 'EUR')).toBe('—')
    expect(paidCell(r({ paid: 89.95, paid_litres: 48.7, payments: 1 }), 'EUR')).toBe('89.95 EUR for 48.7 l')
    expect(paidCell(r({ paid: 61.5, payments: 2 }), 'EUR')).toBe('61.50 EUR (2 payments)')
  })
})

describe('the summary', () => {
  it('tells the estimate and the amounts paid apart', () => {
    expect(summaryLine(d())).toBe('7 fill-ups in this period: about 298 l, an estimated 523.48 EUR. You noted paying 422.98 EUR for 5 of them.')
  })
  it('says how many are doubtful, and copes with one fill-up', () => {
    expect(summaryLine(d({ fill_ups: 1, doubtful: 1, litres: 20, est_cost: null, paid: null, paid_fill_ups: 0 }))).toBe(
      '1 fill-up in this period: about 20 l. 1 of them is doubtful.',
    )
  })
  it('shows only the count without a tank size, and says what to set', () => {
    const none = d({ tank_litres: null, litres: null, est_cost: null, paid: null })
    expect(summaryLine(none)).toBe('7 fill-ups in this period.')
    expect(missingSetting(none, 'cx60')).toContain('tank_litres')
    expect(missingSetting(none, 'cx60')).toContain('config/models/cx60/settings.yaml')
    expect(missingSetting(d({ currency: null, est_cost: null }), 'cx5')).toContain('fuel price')
    expect(missingSetting(d(), 'cx5')).toBeNull()
  })
  it('says so when there is none', () => {
    const empty = d({ fill_ups: 0, refuels: [], litres: null, est_cost: null, paid: null })
    expect(summaryLine(empty)).toBe('No fill-up seen in this period.')
    expect(missingSetting(empty, 'cx5')).toBeNull()
    expect(lastFillUp(empty)).toBeNull()
    expect(summaryLine(undefined)).toBeNull()
  })
  it('names the newest fill-up for the Overview, skipping a doubtful one when there is a clear one', () => {
    expect(lastFillUp(d())).toBe(`last fill-up by ${fmtDate('2026-06-06T15:44:55Z')}, about 41 l`)
    const doubtfulFirst = d({ refuels: [r({ doubtful: true, after_at: '2026-06-20T10:00:00Z', litres: 4 }), r()] })
    expect(lastFillUp(doubtfulFirst)).toContain(fmtDate('2026-06-06T15:44:55Z'))
    expect(lastFillUp(d({ refuels: [r({ litres: null })] }))).toBe(`last fill-up by ${fmtDate('2026-06-06T15:44:55Z')}`)
  })
  it('never calls an estimate what was paid', () => {
    const text = [summaryLine(d()), ...REFUEL_NOTES].join(' ')
    expect(text).toContain('estimate')
    expect(text).toContain('between two status reports')
    expect(summaryLine(d({ paid: null, paid_fill_ups: 0 }))).not.toMatch(/paid|paying/)
  })
})
