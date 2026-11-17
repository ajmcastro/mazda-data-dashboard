// Pure wording of the unusual status reports (PLAN.md M64). No React in here.
// A report is "unlike this car's other reports", never a fault, a cause or a judgement: the car being used at
// 03:00 or the hazard lights on once are facts about the reports, nothing more.

import { msg, tr, trn } from './i18n'
import type { UnusualReason, UnusualReport, UnusualReports } from './api/types'
import { andList, fmtNum } from './lib'
import { pressureText } from './units'

/** Reports this close together (a status report and a door report a few minutes apart) are one moment. */
export const MOMENT_MINUTES = 15

const OPEN_PART: Record<string, string> = {
  door_driver: msg('the driver door'),
  door_passenger: msg('the passenger door'),
  door_rear_left: msg('the rear left door'),
  door_rear_right: msg('the rear right door'),
  trunk: msg('the trunk'),
  hood: msg('the hood'),
  hazard: msg('the hazard lights'),
}

const two = (n: number) => String(n).padStart(2, '0')

/** The open parts of a door report, in words: "the driver door and the trunk". */
export function openParts(label: string | null | undefined): string {
  const parts = (label ?? '').split(',').filter(Boolean)
  return andList(parts.map((p) => (p in OPEN_PART ? tr(OPEN_PART[p]) : p)))
}

/** "usually 0" / "usually 0 to 10": the 10th to 90th percentile of a figure, already formatted. */
function usual(low: string, high: string): string {
  return low === high ? tr('usually {value}', { value: low }) : tr('usually {low} to {high}', { low, high })
}

/** One reason, as a sentence fragment. */
export function reasonText(r: UnusualReason): string {
  switch (r.feature) {
    case 'fuel_drop_parked':
      return tr('the fuel level fell {n} points while the odometer did not move ({usual})', {
        n: fmtNum(r.value, 1),
        usual: usual(fmtNum(r.usual_low, 1), fmtNum(r.usual_high, 1)),
      })
    case 'tire_spread':
      return tr('the four tire pressures were {spread} apart ({usual})', {
        spread: pressureText(r.value),
        usual: usual(pressureText(r.usual_low), pressureText(r.usual_high)),
      })
    case 'hour': {
      const h = r.value ?? 0
      return tr('a report between {from} and {to}, an hour with {share}% of the reports', {
        from: `${two(h)}:00`,
        to: `${two(h)}:59`,
        share: fmtNum(r.share_pct, 1),
      })
    }
    case 'open':
      return tr('{parts} open, as in {share}% of the door reports', { parts: openParts(r.label), share: fmtNum(r.share_pct, 1) })
    default:
      return r.feature
  }
}

/** Reports a few minutes apart grouped into one moment, newest first, reasons said once. */
export interface Moment {
  at: string
  local: string
  /** The reports of the moment, oldest first (the Day page and the scrubber match them by time). */
  reports: string[]
  reasons: UnusualReason[]
}

const reasonKey = (r: UnusualReason) => `${r.feature}|${r.value ?? ''}|${r.label ?? ''}`

export function moments(reports: UnusualReport[] | undefined, minutes = MOMENT_MINUTES): Moment[] {
  const oldest = [...(reports ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const out: Moment[] = []
  for (const r of oldest) {
    const last = out[out.length - 1]
    const close = last && Date.parse(r.at) - Date.parse(last.reports[last.reports.length - 1]) <= minutes * 60_000
    const m = close ? last : { at: r.at, local: r.local, reports: [], reasons: [] }
    if (!close) out.push(m)
    m.reports.push(r.at)
    for (const reason of r.reasons) if (!m.reasons.some((x) => reasonKey(x) === reasonKey(reason))) m.reasons.push(reason)
  }
  return out.reverse()
}

/** The headline of the panel, or a sentence saying why nothing can be said. */
export function summaryLine(u: UnusualReports | undefined): string | null {
  if (!u) return null
  if (!u.enough_status && !u.enough_doors) {
    return tr('Too few reports to tell what is usual for this car (at least {n} of a kind).', { n: u.min_reports })
  }
  const checked = u.status_reports + u.doors_reports
  if (checked === 0) return tr('No reports in this period.')
  const found = moments(u.reports).length
  const reports = trn('1 report', '{n} reports', checked, { n: fmtNum(checked) })
  return found === 0
    ? tr('None of the {reports} of the period stands out from the car’s other reports.', { reports })
    : trn(
        '1 moment of the {reports} of the period stands out from the car’s other reports.',
        '{n} moments of the {reports} of the period stand out from the car’s other reports.',
        found,
        { reports },
      )
}

/**
 * The moment a report belongs to, or undefined: its own time, or within `minutes` of one of the moment's
 * reports (the scrubber steps through status reports only, and a moment may come from a door report).
 */
export function momentOf(at: string | null | undefined, list: Moment[], minutes = 0): Moment | undefined {
  if (!at) return undefined
  const t = Date.parse(at)
  return list.find((m) => m.reports.some((r) => Math.abs(Date.parse(r) - t) <= minutes * 60_000))
}

/** How it is worked out, for the note under the panel. */
export const UNUSUAL_NOTE = msg(
  'What is usual is learned from all of this car’s reports. A report is listed when a figure is far from its usual value (a robust z-score of {z} or more, never finer than the gauge’s own step) or when fewer than {pct}% of the reports share it. It says the report is unlike the others, not that anything is wrong.',
)

/** The reasons a report of the Day page stands out (same kind, same time), or null. */
export function standsOut(kind: string, at: string | null | undefined, reports: UnusualReport[] | undefined): string | null {
  if (!at || (kind !== 'status' && kind !== 'doors')) return null
  const t = Date.parse(at)
  const found = (reports ?? []).find((r) => r.kind === kind && Date.parse(r.at) === t)
  return found ? tr('stands out: {reasons}', { reasons: found.reasons.map(reasonText).join('; ') }) : null
}
