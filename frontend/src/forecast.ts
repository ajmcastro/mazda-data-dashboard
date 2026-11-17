// Pure wording of the maintenance and mileage forecast (PLAN.md M52), and its calendar file. No React in here.
// Every date is "at the recent pace" and counted from the newest day with data, which the text says.

import { tr } from './i18n'
import type { Forecast, MonthForecast, TireForecast } from './api/types'
import { fmtDate, fmtNum } from './lib'
import { WHEEL_NAME } from './tires'
import { distanceText, pressureText } from './units'

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined

/** "around 25 Jun 2026" or "between 25 Jun 2026 and 02 Aug 2026"; null without a date. */
export function dateSpan(first: string | null | undefined, last: string | null | undefined): string | null {
  if (!first) return null
  return !last || last === first ? tr('around {date}', { date: fmtDate(first) }) : tr('between {a} and {b}', { a: fmtDate(first), b: fmtDate(last) })
}

/** The pace behind the dates: "40 km a day over the last 30 days, 27 km over the last 90". */
export function paceText(f: Forecast): string | null {
  const parts: string[] = []
  if (has(f.km_per_day_30d)) parts.push(tr('{distance} a day over the last 30 days', { distance: distanceText(f.km_per_day_30d) }))
  if (has(f.km_per_day_90d)) parts.push(tr('{distance} a day over the last 90', { distance: distanceText(f.km_per_day_90d) }))
  return parts.length ? parts.join(', ') : null
}

/** The oil change in words; null for a car that sends no countdown. */
export function oilAhead(f: Forecast | undefined): string | null {
  if (!f?.has_data || !has(f.oil_left_km)) return null
  const left = tr("{distance} left on the car's oil countdown", { distance: distanceText(f.oil_left_km) })
  const when = dateSpan(f.oil_date_first, f.oil_date_last)
  if (!when) return `${left[0].toUpperCase()}${left.slice(1)}. ${tr('The recent driving gives no date for it (too little driving, or too little data).')}`
  return tr('Oil change {when} at your recent pace: {left}, {pace}.', { when, left, pace: paceText(f) ?? '' })
}

/** The year's distance in words; null without any pace. */
export function yearAhead(f: Forecast | undefined): string | null {
  if (!f?.has_data) return null
  if (f.year_start && has(f.year_km)) {
    const since = f.year_counted_from
      ? tr('since {from}, where your data starts (the year began {start})', { from: fmtDate(f.year_counted_from), start: fmtDate(f.year_start) })
      : tr('since {date}', { date: fmtDate(f.year_start) })
    let text = tr('{distance} so far this year ({since})', { distance: distanceText(f.year_km), since })
    if (has(f.year_projected_km) && f.year_end) {
      text += `; ${tr('at the recent pace about {distance} by {date}', { distance: distanceText(f.year_projected_km), date: fmtDate(f.year_end) })}`
      if (has(f.year_over_km) && has(f.mileage_limit_km)) {
        const limit = tr('your {distance} limit', { distance: distanceText(f.mileage_limit_km) })
        const against =
          f.year_over_km > 0
            ? tr('{distance} over {limit}', { distance: distanceText(f.year_over_km), limit })
            : f.year_over_km < 0
              ? tr('{distance} under {limit}', { distance: distanceText(-f.year_over_km), limit })
              : tr('right at {limit}', { limit })
        text += `, ${against}`
      }
    }
    return `${text[0].toUpperCase()}${text.slice(1)}.`
  }
  return has(f.km_per_year) ? tr('At the recent pace about {distance} a year.', { distance: distanceText(f.km_per_year) }) : null
}

/** What the dates stand on, said once. */
export const aheadBasis = (f: Forecast): string =>
  tr('Counted from {date}, the newest day with data, not from today. A pace is the odometer over the last 30 or 90 days; the dates move as you drive more or less.', { date: fmtDate(f.as_of) })

/** A short date for the All cars card, or null. */
export const oilWhen = (g: { oil_date_first?: string | null; oil_date_last?: string | null }): string | null => {
  const when = dateSpan(g.oil_date_first, g.oil_date_last)
  return when ? tr('{when} at the recent pace', { when }) : null
}

// ------------------------------------------------------------------ calendar

export interface CalendarEvent {
  /** YYYY-MM-DD, an all-day event */
  date: string
  summary: string
  description: string
  /** stable per car and kind, so importing again replaces instead of duplicating */
  uid: string
}

/** The forecasts that have a date, as events. Units follow the reader's choice, as on the page. */
export function calendarEvents(car: { id: string; name: string }, f: Forecast | undefined, tires: TireForecast | undefined): CalendarEvent[] {
  const out: CalendarEvent[] = []
  const basis = f?.as_of ? ` ${tr('An estimate from the data up to {date}.', { date: fmtDate(f.as_of) })}` : ` ${tr('An estimate.')}`
  if (f?.oil_date_first && has(f.oil_left_km)) {
    out.push({
      date: f.oil_date_first,
      summary: tr('{car}: oil change (estimate)', { car: car.name }),
      description: `${tr("Oil change {when} at the recent pace; {distance} left on the car's countdown.", { when: dateSpan(f.oil_date_first, f.oil_date_last) ?? '', distance: distanceText(f.oil_left_km) })}${basis}`,
      uid: `oil-${car.id}`,
    })
  }
  if (f?.year_end && has(f.year_projected_km)) {
    const limit = has(f.mileage_limit_km) ? `, ${tr('against a limit of {distance}', { distance: distanceText(f.mileage_limit_km) })}` : ''
    out.push({
      date: f.year_end,
      summary: tr('{car}: mileage year ends', { car: car.name }),
      description: `${tr('About {distance} by this day at the recent pace', { distance: distanceText(f.year_projected_km) })}${limit}.${basis}`,
      uid: `year-${car.id}`,
    })
  }
  for (const w of tires?.wheels ?? []) {
    if (!w.losing || !w.reaches_limit_on) continue
    const name = tr(WHEEL_NAME[w.wheel] ?? w.wheel)
    out.push({
      date: w.reaches_limit_on,
      summary: tr('{car}: {wheel} tire at {limit} (estimate)', { car: car.name, wheel: name, limit: pressureText(tires!.limit_kpa) }),
      description: tr('The {wheel} tire is losing pressure against the other three and reaches {limit} around this day at that rate. An estimate.', { wheel: name, limit: pressureText(tires!.limit_kpa) }),
      uid: `tire-${w.wheel}-${car.id}`,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid))
}

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const compact = (day: string) => day.replace(/-/g, '')
function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
}

/** Fold a content line at 75 octets, as the format asks (continuation lines start with a space). */
export function fold(line: string): string {
  const bytes = new TextEncoder()
  const out: string[] = []
  let current = ''
  for (const ch of line) {
    if (bytes.encode(current + ch).length > (out.length === 0 ? 75 : 74)) {
      out.push(current)
      current = ''
    }
    current += ch
  }
  out.push(current)
  return out.join('\r\n ')
}

/** An iCalendar file (RFC 5545) of all-day events; `stamp` is when it was made (UTC). */
export function icsFile(events: readonly CalendarEvent[], stamp: Date): string {
  const at = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mazda Data Dashboard//Forecast//EN', 'CALSCALE:GREGORIAN']
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@mazda-data-dashboard`,
      `DTSTAMP:${at}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

// ------------------------------------------------------------ the next 30 days (M71)

/** "Over the next 30 days, at this pace: 600 km to 1,790 km (about 1,130 km), about 40 l to 119 l, 76 EUR to 228 EUR
 * estimated." Null without enough days. Ranges throughout: the middle 80% of the imagined months. */
export function monthAhead(m: MonthForecast | undefined): string | null {
  if (!m?.enough || m.km_low == null || m.km_mid == null || m.km_high == null) return null
  const parts = [
    tr('{low} to {high} (about {mid})', { low: distanceText(m.km_low), high: distanceText(m.km_high), mid: distanceText(m.km_mid) }),
  ]
  if (m.litres_low != null && m.litres_high != null) {
    parts.push(tr('about {low} l to {high} l of fuel', { low: fmtNum(m.litres_low), high: fmtNum(m.litres_high) }))
  }
  if (m.cost_low != null && m.cost_high != null && m.currency) {
    parts.push(tr('an estimated {low} to {high} {currency}', { low: fmtNum(m.cost_low), high: fmtNum(m.cost_high), currency: m.currency }))
  }
  return tr('Over the next {days} days, at this pace: {parts}.', { days: m.month_days, parts: parts.join(', ') })
}

/** What the range rests on, said once. */
export function monthBasis(m: MonthForecast | undefined): string | null {
  if (!m) return null
  if (!m.enough) {
    return m.as_of
      ? tr('The next {days} days need {min} days with a report in the last {window}; there are {n}.', {
          days: m.month_days, min: m.min_days, window: m.window_days, n: m.days_with_data,
        })
      : null
  }
  const basis = tr(
    'The range for the next {days} days is made from this car’s own last {window} days ({n} with a report), taken a week at a time in {replicates} different orders; it is the middle 80% of the results.',
    { days: m.month_days, window: m.window_days, n: m.days_with_data, replicates: fmtNum(m.replicates) },
  )
  const fuel = m.consumption_from && m.l_per_100km != null
    ? ` ${tr('Fuel uses the consumption since {date}.', { date: fmtDate(m.consumption_from) })}`
    : ''
  const seasons = m.months_of_data < 12 ? ` ${tr('With less than a year of data it cannot allow for the season.')}` : ''
  return basis + fuel + seasons
}
