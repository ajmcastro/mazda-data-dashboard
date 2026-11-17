import { afterEach, describe, expect, it } from 'vitest'
import type { Forecast, MonthForecast, TireForecast } from './api/types'
import { aheadBasis, calendarEvents, dateSpan, fold, icsFile, monthAhead, monthBasis, oilAhead, oilWhen, paceText, yearAhead } from './forecast'
import { tr } from './i18n'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'
import { fmtDate, fmtNum } from './lib'
import { DEFAULT_UNITS, setUnits } from './units'

afterEach(() => setUnits(DEFAULT_UNITS))

const f = (over: Partial<Forecast> = {}): Forecast => ({
  has_data: true, as_of: '2026-11-10', odometer_km: 6541.9, km_per_day_30d: 37.9, km_per_day_90d: 40.4, km_per_year: 14800,
  oil_left_km: 7000, oil_days_first: 174, oil_days_last: 185, oil_date_first: '2027-05-03', oil_date_last: '2027-05-14',
  mileage_limit_km: null, year_start: null, year_end: null, year_km: null, year_counted_from: null, year_projected_km: null,
  year_over_km: null, ...over,
})
const year = { mileage_limit_km: 15000, year_start: '2026-07-01', year_end: '2027-07-01', year_km: 5334, year_projected_km: 14800, year_over_km: -200 }
const CAR = { id: 'cx5', name: 'Mazda CX-5' }

describe('the oil change ahead', () => {
  it('is two dates at the recent pace, with what they stand on', () => {
    expect(dateSpan('2027-05-03', '2027-05-14')).toBe(`between ${fmtDate('2027-05-03')} and ${fmtDate('2027-05-14')}`)
    expect(dateSpan('2027-05-03', '2027-05-03')).toBe(`around ${fmtDate('2027-05-03')}`)
    expect(dateSpan(null, null)).toBeNull()
    expect(oilAhead(f())).toBe(
      `Oil change between ${fmtDate('2027-05-03')} and ${fmtDate('2027-05-14')} at your recent pace: ${fmtNum(7000)} km left on the car's oil countdown, 38 km a day over the last 30 days, 40 km a day over the last 90.`,
    )
    expect(paceText(f({ km_per_day_90d: null }))).toBe('38 km a day over the last 30 days')
    expect(paceText(f({ km_per_day_30d: null, km_per_day_90d: null }))).toBeNull()
  })
  it('is withheld for a car without a countdown and says so when the driving gives no date', () => {
    expect(oilAhead(f({ oil_left_km: null, oil_date_first: null, oil_date_last: null }))).toBeNull()
    expect(oilAhead(undefined)).toBeNull()
    expect(oilAhead(f({ has_data: false }))).toBeNull()
    expect(oilAhead(f({ oil_date_first: null, oil_date_last: null }))).toBe(
      `${fmtNum(7000)} km left on the car's oil countdown. The recent driving gives no date for it (too little driving, or too little data).`,
    )
  })
  it('gives the All cars card a short date', () => {
    expect(oilWhen({ oil_date_first: '2027-05-03', oil_date_last: '2027-05-14' })).toBe(
      `between ${fmtDate('2027-05-03')} and ${fmtDate('2027-05-14')} at the recent pace`,
    )
    expect(oilWhen({ oil_date_first: null })).toBeNull()
  })
})

describe('the year ahead', () => {
  it('shows only the yearly pace without a limit', () => {
    expect(yearAhead(f())).toBe(`At the recent pace about ${fmtNum(14800)} km a year.`)
    expect(yearAhead(f({ km_per_year: null }))).toBeNull()
    expect(yearAhead(undefined)).toBeNull()
  })
  it('sets the projection against the limit, under or over', () => {
    expect(yearAhead(f(year))).toBe(
      `${fmtNum(5334)} km so far this year (since ${fmtDate('2026-07-01')}); at the recent pace about ${fmtNum(14800)} km by ${fmtDate('2027-07-01')}, 200 km under your ${fmtNum(15000)} km limit.`,
    )
    expect(yearAhead(f({ ...year, year_projected_km: 17400, year_over_km: 2400 }))).toContain(`${fmtNum(2400)} km over your ${fmtNum(15000)} km limit`)
    expect(yearAhead(f({ ...year, year_projected_km: 15000, year_over_km: 0 }))).toContain('right at your')
  })
  it('says from when it counts when the data starts inside the year', () => {
    expect(yearAhead(f({ ...year, year_counted_from: '2026-08-12' }))).toContain(
      `(since ${fmtDate('2026-08-12')}, where your data starts (the year began ${fmtDate('2026-07-01')}))`,
    )
  })
  it('follows the reader\'s distance unit and says what the dates stand on', () => {
    setUnits({ ...DEFAULT_UNITS, distance: 'mi' })
    expect(yearAhead(f())).toBe(`At the recent pace about ${fmtNum(9196)} mi a year.`)
    expect(oilAhead(f())).toContain(`${fmtNum(4350)} mi left`)
    expect(aheadBasis(f())).toContain(`Counted from ${fmtDate('2026-11-10')}, the newest day with data, not from today.`)
  })
})

describe('the calendar file', () => {
  const tires: TireForecast = {
    limit_kpa: 200, window_days: 30, min_measurements: 8, min_span_days: 10,
    wheels: [
      { wheel: 'fl', measurements: 20, span_days: 20, enough: true, losing: false, below_limit: false },
      { wheel: 'rl', measurements: 20, span_days: 20, enough: true, losing: true, below_limit: false, kpa_per_week: -7, days_left: 30, reaches_limit_on: '2026-12-10' },
    ] as TireForecast['wheels'],
  }
  it('has one event per forecast with a date, in date order', () => {
    const events = calendarEvents(CAR, f(year), tires)
    expect(events.map((e) => [e.date, e.uid])).toEqual([['2026-12-10', 'tire-rl-cx5'], ['2027-05-03', 'oil-cx5'], ['2027-07-01', 'year-cx5']])
    expect(events[0].summary).toBe('Mazda CX-5: rear left tire at 200 kPa (estimate)')
    expect(events[1].description).toContain('An estimate from the data up to')
    expect(calendarEvents(CAR, f({ oil_date_first: null }), undefined)).toEqual([])
    expect(calendarEvents(CAR, undefined, undefined)).toEqual([])
  })
  it('is a valid all-day iCalendar file', () => {
    const text = icsFile(calendarEvents(CAR, f(year), tires), new Date(Date.UTC(2026, 10, 15, 8, 30, 5)))
    const lines = text.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines.at(-2)).toBe('END:VCALENDAR')
    expect(lines.at(-1)).toBe('')
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    expect(text).toContain('UID:oil-cx5@mazda-data-dashboard')
    expect(text).toContain('DTSTAMP:20261115T083005Z')
    expect(text).toContain('DTSTART;VALUE=DATE:20270503\r\nDTEND;VALUE=DATE:20270504')
    expect(text).toContain('DTSTART;VALUE=DATE:20270701\r\nDTEND;VALUE=DATE:20270702')
    expect(text).toContain('SUMMARY:Mazda CX-5: oil change (estimate)')
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(text).not.toMatch(/[^\r]\n/) // CRLF only
  })
  it('escapes and folds text', () => {
    const text = icsFile([{ date: '2026-12-31', summary: 'a, b; c\\d', description: 'two\nlines', uid: 'x' }], new Date(0))
    expect(text).toContain('SUMMARY:a\\, b\; c\\\\d')
    expect(text).toContain('DESCRIPTION:two\\nlines')
    expect(text).toContain('DTEND;VALUE=DATE:20270101') // the day after, across a year
    const long = fold(`DESCRIPTION:${'é'.repeat(100)}`)
    expect(long.split('\r\n').length).toBeGreaterThan(2)
    expect(long.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true)
    expect(long.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'é'.repeat(100)}`)
  })
})

describe('the next 30 days (M71)', () => {
  const month = (over: Partial<MonthForecast> = {}): MonthForecast => ({
    enough: true, as_of: '2026-11-10', window_days: 90, month_days: 30, block_days: 7, replicates: 1000, min_days: 30,
    days_with_data: 42, months_of_data: 5, km_low: 598, km_mid: 1126, km_high: 1788, l_per_100km: 6.63,
    consumption_from: '2026-08-13', litres_low: 40, litres_mid: 75, litres_high: 119, price_per_l: 1.922, currency: 'EUR',
    cost_low: 76, cost_mid: 143, cost_high: 228, ...over,
  })

  it('gives distance, fuel and cost as ranges', () => {
    expect(monthAhead(month())).toBe(
      'Over the next 30 days, at this pace: 598 km to 1,788 km (about 1,126 km), about 40 l to 119 l of fuel, an estimated 76 to 228 EUR.',
    )
    expect(monthAhead(month({ cost_low: null, cost_high: null, currency: null }))).not.toMatch(/estimated/)
    expect(monthAhead(month({ enough: false }))).toBeNull()
    expect(monthAhead(undefined)).toBeNull()
  })

  it('follows the reader’s distance unit', () => {
    setUnits({ ...DEFAULT_UNITS, distance: 'mi' })
    expect(monthAhead(month())).toMatch(/: 372 mi to 1,111 mi \(about 700 mi\)/)
  })

  it('says what it rests on, that it knows no seasons, and why there is none', () => {
    expect(monthBasis(month())).toBe(
      'The range for the next 30 days is made from this car’s own last 90 days (42 with a report), taken a week at a time in 1,000 different orders; it is the middle 80% of the results. Fuel uses the consumption since 13 Aug 2026. With less than a year of data it cannot allow for the season.',
    )
    expect(monthBasis(month({ months_of_data: 13 }))).not.toMatch(/season/)
    expect(monthBasis(month({ enough: false, days_with_data: 23 }))).toBe('The next 30 days need 30 days with a report in the last 90; there are 23.')
  })

  it('stays neutral in Portuguese too', () => {
    const all = () => [monthAhead(month()), monthBasis(month())].join(' ')
    expect(all()).not.toMatch(/\b(will|should|must|good|bad|better|worse)\b/i)
    const pt = inPortuguese(all)
    expect(pt).not.toBe(all())
    expect(pt).not.toMatch(PT_VERDICT)
    expect(pt).not.toMatch(ENGLISH_LEFT)
    expect(tr('Over the next {days} days, at this pace: {parts}.', { days: 30, parts: 'x' })).toMatch(/30/)
  })
})
