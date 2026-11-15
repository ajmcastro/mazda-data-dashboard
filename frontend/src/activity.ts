// Pure wording and maths of the "When" panel on Status (PLAN.md M35). No React in here.
// Everything is per DAY, not per event: the warnings table is mostly repeats of the same few codes, and a
// weekday with more days in the period would otherwise look busier.

import { msg, tr } from './i18n'
import type { ActivityPattern } from './api/types'
import { andList } from './lib'

/** A bucket seen on fewer days than this is marked: a pattern from one or two days is not a pattern. */
export const MIN_DAYS = 3

export const WEEKDAYS = [msg('Monday'), msg('Tuesday'), msg('Wednesday'), msg('Thursday'), msg('Friday'), msg('Saturday'), msg('Sunday')]

const two = (n: number) => String(n).padStart(2, '0')

/** "09:00" for the hour bucket 9 (the hour from 09:00 to 09:59, car local time). */
export const hourLabel = (h: number) => `${two(h)}:00`

export interface HourBar {
  hour: number
  label: string
  days: number
  codes: number
  km: number
  few: boolean
}

export function hourBars(p: ActivityPattern | undefined): HourBar[] {
  return (p?.hours ?? []).map((h) => ({
    hour: h.hour,
    label: two(h.hour),
    days: h.active_days,
    codes: h.warning_codes,
    km: h.km,
    few: h.active_days > 0 && h.active_days < MIN_DAYS,
  }))
}

export interface WeekdayBar {
  weekday: number
  name: string
  short: string
  calendarDays: number
  activeDays: number
  /** Share of this weekday's days with a warning or a drive, 0-100. */
  pctOfDays: number | null
  /** Distance seen in status snapshots per calendar day of this weekday. */
  kmPerDay: number | null
  few: boolean
}

export function weekdayBars(p: ActivityPattern | undefined): WeekdayBar[] {
  return (p?.weekdays ?? []).map((w) => ({
    weekday: w.weekday,
    name: tr(WEEKDAYS[w.weekday] ?? String(w.weekday)),
    short: tr(WEEKDAYS[w.weekday] ?? '').slice(0, 3),
    calendarDays: w.calendar_days,
    activeDays: w.active_days,
    pctOfDays: w.calendar_days > 0 ? Math.round((100 * w.active_days) / w.calendar_days) : null,
    kmPerDay: w.calendar_days > 0 ? Math.round((w.km / w.calendar_days) * 10) / 10 : null,
    few: w.calendar_days > 0 && w.calendar_days < MIN_DAYS,
  }))
}

/** The hours (consecutive or not) with the most days of activity, as "11:00, 13:00 and 14:00"; null when none. */
export function busiestHours(bars: HourBar[], n = 3): HourBar[] {
  return bars
    .filter((b) => b.days >= MIN_DAYS)
    .sort((a, b) => b.days - a.days || a.hour - b.hour)
    .slice(0, n)
    .sort((a, b) => a.hour - b.hour)
}


/** One neutral sentence about the hours and the weekdays, or null when there is nothing to say. */
export function summaryLine(hours: HourBar[], days: WeekdayBar[]): string | null {
  const top = busiestHours(hours)
  const parts: string[] = []
  if (top.length) parts.push(tr('Most days with activity fall around {hours}', { hours: andList(top.map((b) => hourLabel(b.hour))) }))
  const usable = days.filter((d) => d.pctOfDays !== null && !d.few)
  if (usable.length >= 2) {
    const most = usable.reduce((a, b) => (b.pctOfDays! > a.pctOfDays! ? b : a))
    parts.push(tr('{weekday}s have activity on {a} of their {b} days', { weekday: most.name, a: most.activeDays, b: most.calendarDays }))
  }
  return parts.length ? `${parts.join('. ')}.` : null
}

/** What counts as activity, for the note under the charts. */
export const ACTIVITY_NOTE =
  msg('A day counts when the car raised a warning or two status snapshots saw it driving. Times are in the car’s own time zone (config). This shows when the car is used, not how it was driven.')
