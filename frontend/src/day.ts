// Pure wording of the day page (PLAN.md M49). No React in here.
// Every time shown is the CAR'S local time (the API converts with the model's car_timezone), never the
// browser's. A drive and a fill-up are known only as "between two reports" and are worded that way.

import { locale } from './i18n'
import type { Day, DayEntry } from './api/types'
import { fmtNum } from './lib'
import { consumptionLabel, distanceText, fmtConsumption, pressureText } from './units'

const DAY_MS = 86_400_000

/** "2026-06-27" -> "Saturday, 27 June 2026" (a calendar day: no time zone involved). */
export function dayTitle(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/** "2026-06-27" -> "27 Jun" */
export function dayShort(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** The day `n` days from `day` (calendar arithmetic in UTC, so no clock change can shift it). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

export const isDay = (text: string | null | undefined): text is string =>
  !!text && /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))

/** A local "YYYY-MM-DD HH:MM" as shown on the page of `day`: the time alone, or with its date when it is another day. */
export function timeOn(local: string | null | undefined, day: string): string {
  if (!local) return '—'
  const [date, time] = local.split(' ')
  return date === day ? time : `${dayShort(date)} ${time}`
}

/** "12:06", "12:06 – 12:15" or, for what is only known between two reports, "between 26 Jun 18:29 and 12:30". */
export function when(e: DayEntry, day: string): string {
  if (e.kind === 'service') return 'that day'
  if (e.kind === 'drive' || e.kind === 'fill_up') return `between ${timeOn(e.local, day)} and ${timeOn(e.local_until, day)}`
  if (e.local_until && e.local_until !== e.local) return `${timeOn(e.local, day)} – ${timeOn(e.local_until, day)}`
  return timeOn(e.local, day)
}

/** The time an entry is placed at on the page (a drive and a fill-up: when they were seen). */
export const placedAt = (e: DayEntry, day: string): string =>
  e.kind === 'service' ? 'that day' : timeOn(e.kind === 'drive' || e.kind === 'fill_up' ? e.local_until : e.local, day)

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 1)}`
const has = (v: number | null | undefined): v is number => v !== null && v !== undefined

export interface Line {
  title: string
  detail: string | null
  /** the page that has more about it, and the address's extra parameters */
  to: string | null
  params?: Record<string, string>
}

/** One entry in words, with the page that has more about it. */
export function describe(e: DayEntry): Line {
  switch (e.kind) {
    case 'drive':
      return {
        title: `Drove ${distanceText(e.km, 1)}`,
        detail: has(e.l_per_100km) ? `${fmtConsumption(e.l_per_100km, 1)} ${consumptionLabel()}, between two status reports` : 'between two status reports',
        to: '/trends',
      }
    case 'status': {
      const parts: string[] = []
      if (has(e.odometer_km)) parts.push(`odometer ${distanceText(e.odometer_km)}`)
      if (has(e.fuel_level_pct)) {
        parts.push(`fuel ${fmtNum(e.fuel_level_pct)} %${has(e.d_fuel_pct) && e.d_fuel_pct !== 0 ? ` (${signed(e.d_fuel_pct)})` : ''}`)
      }
      if (has(e.tire_min_kpa)) parts.push(`lowest tire ${pressureText(e.tire_min_kpa)}`)
      return { title: 'Status report', detail: parts.join(' · ') || null, to: '/status' }
    }
    case 'doors':
      return { title: e.text ? `Open: ${e.text}` : 'Everything closed again', detail: null, to: '/status' }
    case 'warning':
      return {
        title: `Warning ${e.code}${has(e.n) && e.n > 1 ? ` × ${fmtNum(e.n)}` : ''}`,
        detail: e.title ?? null,
        to: '/warnings',
        params: e.code ? { code: e.code } : undefined,
      }
    case 'readout':
      return {
        title: `Fault read-out: ${has(e.n) && e.n > 0 ? `${fmtNum(e.n)} fault${e.n === 1 ? '' : 's'}` : 'no faults'}`,
        detail: e.text ?? null,
        to: '/faults',
      }
    case 'alarm':
      return { title: 'Alarm report', detail: e.text ?? null, to: '/status' }
    case 'fill_up':
      return {
        title: `Fill-up: ${has(e.litres) ? `about ${fmtNum(e.litres, 1)} l` : has(e.d_fuel_pct) ? `${fmtNum(e.d_fuel_pct)} points` : 'seen'}${e.doubtful ? ' (doubtful)' : ''}`,
        detail: has(e.fuel_level_pct) ? `fuel level ${fmtNum(e.fuel_level_pct)} % after it, between two status reports` : 'between two status reports',
        to: '/status',
      }
    case 'diag':
      return {
        title: 'Diagnostic report',
        detail: has(e.odometer_km) ? `odometer ${distanceText(e.odometer_km)}` : null,
        to: '/diagnostics',
        params: e.ref ? { report: e.ref } : undefined,
      }
    case 'service':
      return {
        title: `Service log: ${(e.code ?? 'entry').replace('_', ' ')}`,
        detail: [e.text, has(e.odometer_km) ? `odometer ${distanceText(e.odometer_km)}` : null].filter(Boolean).join(' · ') || null,
        to: '/status',
      }
    case 'alert':
      return { title: `Alert: ${e.title ?? e.code ?? ''}`.trim(), detail: e.text ?? null, to: '/alerts' }
    default:
      return { title: e.kind, detail: e.text ?? null, to: null }
  }
}

/** The day in one line: what was driven, how many warnings, what else. Null for a day with nothing. */
export function summary(d: Day | undefined): string | null {
  if (!d || d.entries.length === 0) return null
  const of = (kind: string) => d.entries.filter((e) => e.kind === kind)
  const said: string[] = []
  const drives = of('drive')
  if (drives.length > 0) said.push(`${distanceText(drives.reduce((s, e) => s + (e.km ?? 0), 0), 1)} driven`)
  const warnings = of('warning')
  if (warnings.length > 0) {
    const events = warnings.reduce((s, e) => s + (e.n ?? 0), 0)
    said.push(`${fmtNum(events)} warning event${events === 1 ? '' : 's'} (${fmtNum(warnings.length)} code${warnings.length === 1 ? '' : 's'})`)
  }
  const count = (kind: string, one: string, many: string) => {
    const n = of(kind).length
    if (n > 0) said.push(`${fmtNum(n)} ${n === 1 ? one : many}`)
  }
  count('status', 'status report', 'status reports')
  count('fill_up', 'fill-up', 'fill-ups')
  count('readout', 'fault read-out', 'fault read-outs')
  count('diag', 'diagnostic report', 'diagnostic reports')
  count('alarm', 'alarm report', 'alarm reports')
  count('alert', 'alert', 'alerts')
  count('service', 'service-log entry', 'service-log entries')
  return said.join(' · ')
}

/** The label of each kind, for the mark next to an entry. */
export const KIND_LABEL: Record<string, string> = {
  drive: 'drive', status: 'status', doors: 'doors', warning: 'warning', readout: 'faults', alarm: 'alarm',
  fill_up: 'fuel', diag: 'diagnostic', alert: 'alert', service: 'service',
}
