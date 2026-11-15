// The report for the mechanic (PLAN.md M54): what goes on the page, composed from the answers the other pages
// already have. Pure: no React, no request of its own. The wording keeps the pages' hedges ("no description
// yet", "tends to", "at this rate", "between two reports") and adds no judgement of its own.

import { msg, tr, trn } from './i18n'
import type { Alert, CarWarnings, DiagHistoryPoint, DtcFrequency, Forecast, Overview, ServiceLog, TireForecast, WarningFlags } from './api/types'
import { alertDetail, alertTitle, codeTitle } from './alerttext'
import { oilAhead } from './forecast'
import { fmtDate, fmtDateTime, fmtNum } from './lib'
import { kindLabel } from './service'
import { forecastLines } from './tires'
import { consumptionLabel, distanceText, fmtConsumption, pressureText } from './units'

export const SECTION_IDS = ['car', 'faults', 'car_warnings', 'lamps', 'tires', 'diagnostics', 'service', 'alerts'] as const
export type SectionId = (typeof SECTION_IDS)[number]

export const SECTION_TITLE: Record<SectionId, string> = {
  car: msg('The car'), faults: msg('Faults'), car_warnings: msg("The car's own warnings"), lamps: msg('Warning-lamp flags that changed'),
  tires: msg('Tires'), diagnostics: msg('Diagnostic report'), service: msg('Service log'), alerts: msg('Open alerts'),
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

/** "12 Jun 2026 to 10 Nov 2026", or all the data when no period is chosen. */
export function periodText(p: { from?: string; to?: string }, o: Overview | undefined): string {
  if (p.from && p.to) return tr('{from} to {to}', { from: fmtDate(p.from), to: fmtDate(p.to) })
  if (p.from) return tr('from {date}', { date: fmtDate(p.from) })
  if (p.to) return tr('up to {date}', { date: fmtDate(p.to) })
  return o?.data_from && o.data_to ? tr('all the data, {from} to {to}', { from: fmtDate(o.data_from), to: fmtDate(o.data_to) }) : tr('all the data')
}

function car(i: ReportInput): Section {
  const o = i.overview
  const lines = [tr('{car}. Period of this report: {period}.', { car: i.car.name, period: periodText(i.period, o) })]
  if (i.showVin && o?.vin) lines.push(`VIN ${o.vin}.`)
  if (o && has(o.odometer_km)) lines.push(`${tr('Odometer {distance}', { distance: distanceText(o.odometer_km) })}${o.odometer_at ? ` ${tr('on {date}', { date: fmtDate(o.odometer_at) })}` : ''}.`)
  if (o && has(o.km_in_range)) {
    const rate = has(o.l_per_100km_in_range) ? `, ${tr('{rate} {unit} on average', { rate: fmtConsumption(o.l_per_100km_in_range, 1), unit: consumptionLabel() })}` : ''
    lines.push(`${tr('{distance} driven in the period', { distance: distanceText(o.km_in_range) })}${rate}.`)
  }
  const oil = oilAhead(i.forecast)
  if (oil) lines.push(oil)
  return { id: 'car', title: tr(SECTION_TITLE.car), lines }
}

function faults(i: ReportInput): Section {
  const list = [...(i.faults ?? [])].sort(
    (a, b) => Number(b.active_in_latest_readout) - Number(a.active_in_latest_readout) || b.last_seen.localeCompare(a.last_seen) || a.dtc_code.localeCompare(b.dtc_code),
  )
  const active = list.filter((f) => f.active_in_latest_readout).length
  return {
    id: 'faults', title: tr(SECTION_TITLE.faults),
    lines: list.length
      ? [trn('{n} fault is listed in the latest read-out; {total} seen in the period or still listed.', '{n} faults are listed in the latest read-out; {total} seen in the period or still listed.', active, { n: fmtNum(active), total: fmtNum(list.length) })]
      : [],
    empty: tr('No fault in the period and none in the latest read-out.'),
    table: list.length
      ? {
          head: [tr('Code'), tr('Unit'), tr('Description'), tr('Latest read-out'), tr('Read-outs'), tr('First seen'), tr('Last seen')],
          rows: list.map((f) => [
            f.failure_type ? `${f.dtc_code}:${f.failure_type}` : f.dtc_code,
            f.ecu_title ? `${f.ecu} (${f.ecu_title})` : f.ecu,
            codeTitle(f.title),
            f.active_in_latest_readout ? tr('listed') : tr('not listed'),
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
    id: 'car_warnings', title: tr(SECTION_TITLE.car_warnings),
    lines: [
      on.length
        ? tr('On in the newest report: {list}.', { list: on.map((f) => `${tr(f.label)}${f.since ? ` (${tr('since {date}', { date: fmtDate(f.since) })})` : ''}`).join(', ') })
        : tr('None of the flags the car reports is on in the newest report.'),
      tr('These are flags the car sends; what a value other than 0 means is not published, so "on" only says it is not 0.'),
    ],
    table: w.episodes.length
      ? {
          head: [tr('Flag'), tr('From'), tr('Last on'), tr('Reports'), tr('Raw value')],
          rows: w.episodes.map((e) => [tr(e.label), fmtDateTime(e.started_at), e.ongoing ? tr('still on') : fmtDateTime(e.last_on_at), fmtNum(e.readings), fmtNum(e.max_value)]),
        }
      : undefined,
  }
}

function lamps(i: ReportInput): Section | null {
  const l = i.lamps
  if (!l?.has_data) return null
  const changed = l.flags.filter((f) => f.readings_on > 0)
  return {
    id: 'lamps', title: tr(SECTION_TITLE.lamps),
    lines: changed.length ? [tr("Bit flags that look like the state of dashboard lamps. Mazda does not publish their meaning; a title is the owner's own note.")] : [],
    empty: tr('None of the warning-lamp flags was on.'),
    table: changed.length
      ? {
          head: [tr('Flag'), tr('Description'), tr('On in'), tr('First on'), tr('Last on'), tr('Now')],
          rows: changed.map((f) => [
            f.flag, f.title ?? tr('no description yet'), tr('{n} of {total} reports', { n: fmtNum(f.readings_on), total: fmtNum(f.readings) }),
            fmtDate(f.first_on_at), fmtDate(f.last_on_at), f.on_now ? tr('on') : tr('off'),
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
  if (known.length) lines.push(tr('Newest pressures: {list}.', { list: known.map(([name, v]) => `${tr(name)} ${pressureText(v)}`).join(', ') }))
  lines.push(...ahead)
  if (ahead.length === 0 && i.tireForecast?.wheels.some((w) => w.enough)) lines.push(tr('No wheel is losing pressure against the other three over the last 30 days.'))
  return { id: 'tires', title: tr(SECTION_TITLE.tires), lines }
}

function diagnostics(i: ReportInput): Section | null {
  const reports = i.diagnostics ?? []
  if (reports.length === 0) return null
  const latest = reports[reports.length - 1]
  const before = reports.length > 1 ? reports[reports.length - 2] : undefined
  const lines = [
    trn(
      'The newest diagnostic report is of {date}{at}: {n} stored fault listed, {passed} of {monitors} emission monitors passed.',
      'The newest diagnostic report is of {date}{at}: {n} stored faults listed, {passed} of {monitors} emission monitors passed.',
      latest.dtcs_listed,
      {
        date: fmtDate(latest.taken_at), at: has(latest.odometer_km) ? ` ${tr('at {distance}', { distance: distanceText(latest.odometer_km) })}` : '',
        n: fmtNum(latest.dtcs_listed), passed: fmtNum(latest.monitors_passed), monitors: fmtNum(latest.monitors_total),
      },
    ),
  ]
  if (before) {
    const changes: string[] = []
    if (latest.dtcs_listed !== before.dtcs_listed) changes.push(tr('stored faults {before} → {now}', { before: fmtNum(before.dtcs_listed), now: fmtNum(latest.dtcs_listed) }))
    if (latest.monitors_passed !== before.monitors_passed || latest.monitors_total !== before.monitors_total) {
      changes.push(tr('monitors passed {a} of {b} → {c} of {d}', { a: fmtNum(before.monitors_passed), b: fmtNum(before.monitors_total), c: fmtNum(latest.monitors_passed), d: fmtNum(latest.monitors_total) }))
    }
    if (has(latest.odometer_km) && has(before.odometer_km)) changes.push(tr('{distance} driven between them', { distance: distanceText(latest.odometer_km - before.odometer_km) }))
    lines.push(tr('Against the report before ({date}): {changes}.', { date: fmtDate(before.taken_at), changes: changes.length ? changes.join('; ') : tr('the same counts') }))
  }
  return { id: 'diagnostics', title: tr(SECTION_TITLE.diagnostics), lines }
}

function service(i: ReportInput): Section | null {
  const entries = i.service?.entries ?? []
  if (entries.length === 0) return null
  return {
    id: 'service', title: tr(SECTION_TITLE.service),
    lines: [tr('What the owner noted was done to the car.')],
    table: {
      head: [tr('Day'), tr('Kind'), tr('Note'), tr('Odometer')],
      rows: entries.map((e) => [fmtDate(e.date), kindLabel(e.kind), e.note, has(e.odometer_km) ? distanceText(e.odometer_km) : '—']),
    },
  }
}

function alerts(i: ReportInput): Section {
  const open = i.alerts ?? []
  return {
    id: 'alerts', title: tr(SECTION_TITLE.alerts),
    lines: open.length ? [tr("Raised by the dashboard's own rules and not acknowledged yet.")] : [],
    empty: tr('No open alert.'),
    table: open.length
      ? { head: [tr('About'), tr('Alert'), tr('Detail')], rows: open.map((a) => [fmtDate(a.occurred_at ?? a.created_at), alertTitle(a.title), a.detail ? alertDetail(a.detail) : '']) }
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
  msg("Made from the car's own data exports (Mazda's Data Act download) by the owner's dashboard. It shows what the car reported, and when; it is not a diagnosis."),
  msg('Descriptions of codes are the owner\'s notes: Mazda does not publish them. "No description yet" means none was noted, not that the code is harmless.'),
  msg('Times between status reports are unknown: a drive, a fill-up or a change is known only as "between two reports". Estimates say so.'),
] as const
