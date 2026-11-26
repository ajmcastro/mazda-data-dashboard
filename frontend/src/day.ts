// Pure wording of the day page (PLAN.md M49). No React in here.
// Every time shown is the CAR'S local time (the API converts with the model's car_timezone), never the
// browser's. A drive and a fill-up are known only as "between two reports" and are worded that way.

import { locale, msg, tr, trn } from './i18n'
import type { Day, DayEntry } from './api/types'
import { alertDetail, alertTitle, codeTitle } from './alerttext'
import { fmtNum } from './lib'
import { consumptionLabel, distanceText, fmtConsumption, pressureText } from './units'
import { alarmText as signalAlarmText, documents, engineStateNote, type Meanings } from './signals'

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
  if (e.kind === 'service') return tr('that day')
  if (e.kind === 'drive' || e.kind === 'fill_up') return tr('between {a} and {b}', { a: timeOn(e.local, day), b: timeOn(e.local_until, day) })
  if (e.local_until && e.local_until !== e.local) return `${timeOn(e.local, day)} – ${timeOn(e.local_until, day)}`
  return timeOn(e.local, day)
}

/** The time an entry is placed at on the page (a drive and a fill-up: when they were seen). */
export const placedAt = (e: DayEntry, day: string): string =>
  e.kind === 'service' ? tr('that day') : timeOn(e.kind === 'drive' || e.kind === 'fill_up' ? e.local_until : e.local, day)

/** What is open comes from the server as English names; an alarm's raw codes as "status N, reason N". */
export const OPEN_NAMES = [msg('driver door'), msg('passenger door'), msg('rear left door'), msg('rear right door'), msg('trunk'), msg('hood'), msg('entry')]
const alarmText = (text: string): string => {
  const m = /^status (\S+), reason (\S+)$/.exec(text)
  return m ? tr('status {status}, reason {reason}', { status: m[1], reason: m[2] }) : text
}

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
export function describe(e: DayEntry, m?: Meanings): Line {
  switch (e.kind) {
    case 'drive':
      return {
        title: tr('Drove {distance}', { distance: distanceText(e.km, 1) }),
        detail: has(e.l_per_100km) ? `${fmtConsumption(e.l_per_100km, 1)} ${consumptionLabel()}, ${tr('between two status reports')}` : tr('between two status reports'),
        to: '/trends',
      }
    case 'status': {
      const parts: string[] = []
      if (has(e.odometer_km)) parts.push(tr('odometer {distance}', { distance: distanceText(e.odometer_km) }))
      if (has(e.fuel_level_pct)) {
        parts.push(`${tr('fuel {n} %', { n: fmtNum(e.fuel_level_pct) })}${has(e.d_fuel_pct) && e.d_fuel_pct !== 0 ? ` (${signed(e.d_fuel_pct)})` : ''}`)
      }
      if (has(e.tire_min_kpa)) parts.push(tr('lowest tire {pressure}', { pressure: pressureText(e.tire_min_kpa) }))
      // the engine state, where the platform documents it (M72)
      const engine = engineStateNote(m, e.engine_state)
      if (engine) parts.push(engine)
      return { title: tr('Status report'), detail: parts.join(' · ') || null, to: '/status' }
    }
    case 'doors':
      return { title: e.text ? tr('Open: {what}', { what: e.text.split(', ').map((x) => tr(x)).join(', ') }) : tr('Everything closed again'), detail: null, to: '/status' }
    case 'warning':
      return {
        title: `${tr('Warning {code}', { code: e.code ?? '' })}${has(e.n) && e.n > 1 ? ` × ${fmtNum(e.n)}` : ''}`,
        detail: e.title ? codeTitle(e.title) : null,
        to: '/warnings',
        params: e.code ? { code: e.code } : undefined,
      }
    case 'readout':
      return {
        title: tr('Fault read-out: {what}', { what: has(e.n) && e.n > 0 ? trn('{n} fault', '{n} faults', e.n, { n: fmtNum(e.n) }) : tr('no faults') }),
        detail: e.text ?? null,
        to: '/faults',
      }
    case 'alarm':
      return {
        title: tr('Alarm report'),
        // in words where the platform documents the values (M72), the raw codes otherwise
        detail: documents(m, 'burglarstatus') ? signalAlarmText(m, e.alarm_status, e.alarm_reason) : e.text ? alarmText(e.text) : null,
        to: '/status',
      }
    case 'fill_up':
      return {
        title: `${tr('Fill-up: {what}', { what: has(e.litres) ? tr('about {n} l', { n: fmtNum(e.litres, 1) }) : has(e.d_fuel_pct) ? tr('{n} points', { n: fmtNum(e.d_fuel_pct) }) : tr('seen') })}${e.doubtful ? ` (${tr('doubtful')})` : ''}`,
        detail: has(e.fuel_level_pct) ? tr('fuel level {n} % after it, between two status reports', { n: fmtNum(e.fuel_level_pct) }) : tr('between two status reports'),
        to: '/status',
      }
    case 'diag':
      return {
        title: tr('Diagnostic report'),
        detail: has(e.odometer_km) ? tr('odometer {distance}', { distance: distanceText(e.odometer_km) }) : null,
        to: '/diagnostics',
        params: e.ref ? { report: e.ref } : undefined,
      }
    case 'service':
      return {
        title: tr('Service log: {kind}', { kind: tr((e.code ?? 'entry').replace('_', ' ')) }),
        detail: [e.text, has(e.odometer_km) ? tr('odometer {distance}', { distance: distanceText(e.odometer_km) }) : null].filter(Boolean).join(' · ') || null,
        to: '/status',
      }
    case 'alert':
      return { title: tr('Alert: {title}', { title: e.title ? alertTitle(e.title) : (e.code ?? '') }).trim(), detail: e.text ? alertDetail(e.text) : null, to: '/alerts' }
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
  if (drives.length > 0) said.push(tr('{distance} driven', { distance: distanceText(drives.reduce((s, e) => s + (e.km ?? 0), 0), 1) }))
  const warnings = of('warning')
  if (warnings.length > 0) {
    const events = warnings.reduce((s, e) => s + (e.n ?? 0), 0)
    said.push(`${trn('{n} warning event', '{n} warning events', events, { n: fmtNum(events) })} (${trn('{n} code', '{n} codes', warnings.length, { n: fmtNum(warnings.length) })})`)
  }
  const count = (kind: string, one: string, many: string) => {
    const n = of(kind).length
    if (n > 0) said.push(trn(one, many, n, { n: fmtNum(n) }))
  }
  count('status', msg('{n} status report'), msg('{n} status reports'))
  count('fill_up', msg('{n} fill-up'), msg('{n} fill-ups'))
  count('readout', msg('{n} fault read-out'), msg('{n} fault read-outs'))
  count('diag', msg('{n} diagnostic report'), msg('{n} diagnostic reports'))
  count('alarm', msg('{n} alarm report'), msg('{n} alarm reports'))
  count('alert', msg('{n} alert'), msg('{n} alerts'))
  count('service', msg('{n} service-log entry'), msg('{n} service-log entries'))
  return said.join(' · ')
}

/** The label of each kind, for the mark next to an entry. */
export const KIND_LABEL: Record<string, string> = {
  drive: msg('drive'), status: msg('status'), doors: msg('doors'), warning: msg('warning'), readout: msg('faults'), alarm: msg('alarm'),
  fill_up: msg('fuel'), diag: msg('diagnostic'), alert: msg('alert'), service: msg('service'),
}
