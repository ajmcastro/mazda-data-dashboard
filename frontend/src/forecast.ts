// Pure wording of the maintenance and mileage forecast (PLAN.md M52), and its calendar file. No React in here.
// Every date is "at the recent pace" and counted from the newest day with data, which the text says.

import type { Forecast, TireForecast } from './api/types'
import { fmtDate } from './lib'
import { WHEEL_NAME } from './tires'
import { distanceText, pressureText } from './units'

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined

/** "around 25 Jun 2026" or "between 25 Jun 2026 and 02 Aug 2026"; null without a date. */
export function dateSpan(first: string | null | undefined, last: string | null | undefined): string | null {
  if (!first) return null
  return !last || last === first ? `around ${fmtDate(first)}` : `between ${fmtDate(first)} and ${fmtDate(last)}`
}

/** The pace behind the dates: "40 km a day over the last 30 days, 27 km over the last 90". */
export function paceText(f: Forecast): string | null {
  const parts: string[] = []
  if (has(f.km_per_day_30d)) parts.push(`${distanceText(f.km_per_day_30d)} a day over the last 30 days`)
  if (has(f.km_per_day_90d)) parts.push(`${distanceText(f.km_per_day_90d)} a day over the last 90`)
  return parts.length ? parts.join(', ') : null
}

/** The oil change in words; null for a car that sends no countdown. */
export function oilAhead(f: Forecast | undefined): string | null {
  if (!f?.has_data || !has(f.oil_left_km)) return null
  const left = `${distanceText(f.oil_left_km)} left on the car's oil countdown`
  const when = dateSpan(f.oil_date_first, f.oil_date_last)
  if (!when) return `${left[0].toUpperCase()}${left.slice(1)}. The recent driving gives no date for it (too little driving, or too little data).`
  return `Oil change ${when} at your recent pace: ${left}, ${paceText(f)}.`
}

/** The year's distance in words; null without any pace. */
export function yearAhead(f: Forecast | undefined): string | null {
  if (!f?.has_data) return null
  if (f.year_start && has(f.year_km)) {
    const since = f.year_counted_from
      ? `since ${fmtDate(f.year_counted_from)}, where your data starts (the year began ${fmtDate(f.year_start)})`
      : `since ${fmtDate(f.year_start)}`
    let text = `${distanceText(f.year_km)} so far this year (${since})`
    if (has(f.year_projected_km) && f.year_end) {
      text += `; at the recent pace about ${distanceText(f.year_projected_km)} by ${fmtDate(f.year_end)}`
      if (has(f.year_over_km) && has(f.mileage_limit_km)) {
        const limit = `your ${distanceText(f.mileage_limit_km)} limit`
        text += f.year_over_km > 0 ? `, ${distanceText(f.year_over_km)} over ${limit}` : f.year_over_km < 0 ? `, ${distanceText(-f.year_over_km)} under ${limit}` : `, right at ${limit}`
      }
    }
    return `${text[0].toUpperCase()}${text.slice(1)}.`
  }
  return has(f.km_per_year) ? `At the recent pace about ${distanceText(f.km_per_year)} a year.` : null
}

/** What the dates stand on, said once. */
export const aheadBasis = (f: Forecast): string =>
  `Counted from ${fmtDate(f.as_of)}, the newest day with data, not from today. A pace is the odometer over the last 30 or 90 days; the dates move as you drive more or less.`

/** A short date for the All cars card, or null. */
export const oilWhen = (g: { oil_date_first?: string | null; oil_date_last?: string | null }): string | null => {
  const when = dateSpan(g.oil_date_first, g.oil_date_last)
  return when ? `${when} at the recent pace` : null
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
  const basis = f?.as_of ? ` An estimate from the data up to ${fmtDate(f.as_of)}.` : ' An estimate.'
  if (f?.oil_date_first && has(f.oil_left_km)) {
    out.push({
      date: f.oil_date_first,
      summary: `${car.name}: oil change (estimate)`,
      description: `Oil change ${dateSpan(f.oil_date_first, f.oil_date_last)} at the recent pace; ${distanceText(f.oil_left_km)} left on the car's countdown.${basis}`,
      uid: `oil-${car.id}`,
    })
  }
  if (f?.year_end && has(f.year_projected_km)) {
    const limit = has(f.mileage_limit_km) ? `, against a limit of ${distanceText(f.mileage_limit_km)}` : ''
    out.push({
      date: f.year_end,
      summary: `${car.name}: mileage year ends`,
      description: `About ${distanceText(f.year_projected_km)} by this day at the recent pace${limit}.${basis}`,
      uid: `year-${car.id}`,
    })
  }
  for (const w of tires?.wheels ?? []) {
    if (!w.losing || !w.reaches_limit_on) continue
    const name = WHEEL_NAME[w.wheel] ?? w.wheel
    out.push({
      date: w.reaches_limit_on,
      summary: `${car.name}: ${name} tire at ${pressureText(tires!.limit_kpa)} (estimate)`,
      description: `The ${name} tire is losing pressure against the other three and reaches ${pressureText(tires!.limit_kpa)} around this day at that rate. An estimate.`,
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
