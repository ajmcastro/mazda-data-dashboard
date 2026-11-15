// The report for the mechanic (PLAN.md M54): what goes on the page, composed from the answers the other pages
// already have. Pure: no React, no request of its own. The wording keeps the pages' hedges ("no description
// yet", "tends to", "at this rate", "between two reports") and adds no judgement of its own.

import type { Alert, CarWarnings, DiagHistoryPoint, DtcFrequency, Forecast, Overview, ServiceLog, TireForecast, WarningFlags } from './api/types'
import { oilAhead } from './forecast'
import { fmtDate, fmtDateTime, fmtNum } from './lib'
import { kindLabel } from './service'
import { forecastLines } from './tires'
import { consumptionLabel, distanceText, fmtConsumption, pressureText } from './units'

export const SECTION_IDS = ['car', 'faults', 'car_warnings', 'lamps', 'tires', 'diagnostics', 'service', 'alerts'] as const
export type SectionId = (typeof SECTION_IDS)[number]

export const SECTION_TITLE: Record<SectionId, string> = {
  car: 'The car', faults: 'Faults', car_warnings: "The car's own warnings", lamps: 'Warning-lamp flags that changed',
  tires: 'Tires', diagnostics: 'Diagnostic report', service: 'Service log', alerts: 'Open alerts',
}

export interface Table {
  head: string[]
  rows: string[][]
}
export interface Section {
  id: SectionId
  title: string
  /** sentences above the table */
  lines: string[]
  table?: Table
  /** what to say when the section has nothing ("None in this period.") */
  empty?: string
  /** the faults to add a freeze-frame line to, in the table's order (the page asks for each) */
  faults?: { ecu: string; dtc_code: string }[]
}

export interface ReportInput {
  car: { id: string; name: string }
  period: { from?: string; to?: string }
  showVin: boolean
  overview?: Overview
  faults?: DtcFrequency[]
  carWarnings?: CarWarnings
  lamps?: WarningFlags
  tireForecast?: TireForecast
  forecast?: Forecast
  diagnostics?: DiagHistoryPoint[]
  service?: ServiceLog
  alerts?: Alert[]
}

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined
const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`

/** "12 Jun 2026 to 10 Nov 2026", or all the data when no period is chosen. */
export function periodText(p: { from?: string; to?: string }, o: Overview | undefined): string {
  if (p.from && p.to) return `${fmtDate(p.from)} to ${fmtDate(p.to)}`
  if (p.from) return `from ${fmtDate(p.from)}`
  if (p.to) return `up to ${fmtDate(p.to)}`
  return o?.data_from && o.data_to ? `all the data, ${fmtDate(o.data_from)} to ${fmtDate(o.data_to)}` : 'all the data'
}

function car(i: ReportInput): Section {
  const o = i.overview
  const lines = [`${i.car.name}. Period of this report: ${periodText(i.period, o)}.`]
  if (i.showVin && o?.vin) lines.push(`VIN ${o.vin}.`)
  if (o && has(o.odometer_km)) lines.push(`Odometer ${distanceText(o.odometer_km)}${o.odometer_at ? ` on ${fmtDate(o.odometer_at)}` : ''}.`)
  if (o && has(o.km_in_range)) {
    const rate = has(o.l_per_100km_in_range) ? `, ${fmtConsumption(o.l_per_100km_in_range, 1)} ${consumptionLabel()} on average` : ''
    lines.push(`${distanceText(o.km_in_range)} driven in the period${rate}.`)
  }
  const oil = oilAhead(i.forecast)
  if (oil) lines.push(oil)
  return { id: 'car', title: SECTION_TITLE.car, lines }
}

function faults(i: ReportInput): Section {
  const list = [...(i.faults ?? [])].sort(
    (a, b) => Number(b.active_in_latest_readout) - Number(a.active_in_latest_readout) || b.last_seen.localeCompare(a.last_seen) || a.dtc_code.localeCompare(b.dtc_code),
  )
  const active = list.filter((f) => f.active_in_latest_readout).length
  return {
    id: 'faults', title: SECTION_TITLE.faults,
    lines: list.length ? [`${plural(active, 'fault is', 'faults are')} listed in the latest read-out; ${fmtNum(list.length)} seen in the period or still listed.`] : [],
    empty: 'No fault in the period and none in the latest read-out.',
    table: list.length
      ? {
          head: ['Code', 'Unit', 'Description', 'Latest read-out', 'Read-outs', 'First seen', 'Last seen'],
          rows: list.map((f) => [
            f.failure_type ? `${f.dtc_code}:${f.failure_type}` : f.dtc_code,
            f.ecu_title ? `${f.ecu} (${f.ecu_title})` : f.ecu,
            f.title,
            f.active_in_latest_readout ? 'listed' : 'not listed',
            fmtNum(f.readouts),
            fmtDate(f.first_seen),
            fmtDate(f.last_seen),
          ]),
        }
      : undefined,
    faults: list.map((f) => ({ ecu: f.ecu, dtc_code: f.dtc_code })),
  }
}

function carWarnings(i: ReportInput): Section | null {
  const w = i.carWarnings
  if (!w?.has_data) return null
  const on = w.flags.filter((f) => f.is_on)
  return {
    id: 'car_warnings', title: SECTION_TITLE.car_warnings,
    lines: [
      on.length
        ? `On in the newest report: ${on.map((f) => `${f.label}${f.since ? ` (since ${fmtDate(f.since)})` : ''}`).join(', ')}.`
        : 'None of the flags the car reports is on in the newest report.',
      'These are flags the car sends; what a value other than 0 means is not published, so "on" only says it is not 0.',
    ],
    table: w.episodes.length
      ? {
          head: ['Flag', 'From', 'Last on', 'Reports', 'Raw value'],
          rows: w.episodes.map((e) => [e.label, fmtDateTime(e.started_at), e.ongoing ? 'still on' : fmtDateTime(e.last_on_at), fmtNum(e.readings), fmtNum(e.max_value)]),
        }
      : undefined,
  }
}

function lamps(i: ReportInput): Section | null {
  const l = i.lamps
  if (!l?.has_data) return null
  const changed = l.flags.filter((f) => f.readings_on > 0)
  return {
    id: 'lamps', title: SECTION_TITLE.lamps,
    lines: changed.length ? ['Bit flags that look like the state of dashboard lamps. Mazda does not publish their meaning; a title is the owner\'s own note.'] : [],
    empty: 'None of the warning-lamp flags was on.',
    table: changed.length
      ? {
          head: ['Flag', 'Description', 'On in', 'First on', 'Last on', 'Now'],
          rows: changed.map((f) => [
            f.flag, f.title ?? 'no description yet', `${fmtNum(f.readings_on)} of ${fmtNum(f.readings)} reports`,
            fmtDate(f.first_on_at), fmtDate(f.last_on_at), f.on_now ? 'on' : 'off',
          ]),
        }
      : undefined,
  }
}

function tires(i: ReportInput): Section | null {
  const s = i.overview?.status
  const wheels: [string, number | null | undefined][] = [
    ['front left', s?.tire_fl_kpa], ['front right', s?.tire_fr_kpa], ['rear left', s?.tire_rl_kpa], ['rear right', s?.tire_rr_kpa],
  ]
  const known = wheels.filter(([, v]) => has(v))
  const ahead = forecastLines(i.tireForecast)
  if (known.length === 0 && ahead.length === 0) return null
  const lines: string[] = []
  if (known.length) lines.push(`Newest pressures: ${known.map(([name, v]) => `${name} ${pressureText(v)}`).join(', ')}.`)
  lines.push(...ahead)
  if (ahead.length === 0 && i.tireForecast?.wheels.some((w) => w.enough)) lines.push('No wheel is losing pressure against the other three over the last 30 days.')
  return { id: 'tires', title: SECTION_TITLE.tires, lines }
}

function diagnostics(i: ReportInput): Section | null {
  const reports = i.diagnostics ?? []
  if (reports.length === 0) return null
  const latest = reports[reports.length - 1]
  const before = reports.length > 1 ? reports[reports.length - 2] : undefined
  const lines = [
    `The newest diagnostic report is of ${fmtDate(latest.taken_at)}${has(latest.odometer_km) ? ` at ${distanceText(latest.odometer_km)}` : ''}: ` +
      `${plural(latest.dtcs_listed, 'stored fault', 'stored faults')} listed, ${fmtNum(latest.monitors_passed)} of ${fmtNum(latest.monitors_total)} emission monitors passed.`,
  ]
  if (before) {
    const changes: string[] = []
    if (latest.dtcs_listed !== before.dtcs_listed) changes.push(`stored faults ${fmtNum(before.dtcs_listed)} → ${fmtNum(latest.dtcs_listed)}`)
    if (latest.monitors_passed !== before.monitors_passed || latest.monitors_total !== before.monitors_total) {
      changes.push(`monitors passed ${fmtNum(before.monitors_passed)} of ${fmtNum(before.monitors_total)} → ${fmtNum(latest.monitors_passed)} of ${fmtNum(latest.monitors_total)}`)
    }
    if (has(latest.odometer_km) && has(before.odometer_km)) changes.push(`${distanceText(latest.odometer_km - before.odometer_km)} driven between them`)
    lines.push(`Against the report before (${fmtDate(before.taken_at)}): ${changes.length ? changes.join('; ') : 'the same counts'}.`)
  }
  return { id: 'diagnostics', title: SECTION_TITLE.diagnostics, lines }
}

function service(i: ReportInput): Section | null {
  const entries = i.service?.entries ?? []
  if (entries.length === 0) return null
  return {
    id: 'service', title: SECTION_TITLE.service,
    lines: ['What the owner noted was done to the car.'],
    table: {
      head: ['Day', 'Kind', 'Note', 'Odometer'],
      rows: entries.map((e) => [fmtDate(e.date), kindLabel(e.kind), e.note, has(e.odometer_km) ? distanceText(e.odometer_km) : '—']),
    },
  }
}

function alerts(i: ReportInput): Section {
  const open = i.alerts ?? []
  return {
    id: 'alerts', title: SECTION_TITLE.alerts,
    lines: open.length ? ["Raised by the dashboard's own rules and not acknowledged yet."] : [],
    empty: 'No open alert.',
    table: open.length
      ? { head: ['About', 'Alert', 'Detail'], rows: open.map((a) => [fmtDate(a.occurred_at ?? a.created_at), a.title, a.detail ?? '']) }
      : undefined,
  }
}

/** The sections of the report, in order, leaving out those the car has nothing for and those unticked. */
export function buildReport(i: ReportInput, include: ReadonlySet<SectionId> = new Set(SECTION_IDS)): Section[] {
  const all = [car(i), faults(i), carWarnings(i), lamps(i), tires(i), diagnostics(i), service(i), alerts(i)]
  return all.filter((s): s is Section => s !== null && include.has(s.id))
}

/** Whether a section has anything but its "nothing" sentence. */
export const isEmpty = (s: Section): boolean => s.lines.length === 0 && !s.table

export const REPORT_FOOTER = [
  "Made from the car's own data exports (Mazda's Data Act download) by the owner's dashboard. It shows what the car reported, and when; it is not a diagnosis.",
  'Descriptions of codes are the owner\'s notes: Mazda does not publish them. "No description yet" means none was noted, not that the code is harmless.',
  'Times between status reports are unknown: a drive, a fill-up or a change is known only as "between two reports". Estimates say so.',
] as const
