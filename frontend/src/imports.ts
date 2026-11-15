// Pure wording of the import page (PLAN.md M53). No React in here.
// It says what one load changed, in counts and names from the server; it never interprets a fault or a code.

import type { ImportSummary } from './api/types'
import { fmtDate, fmtNum } from './lib'
import { distanceText } from './units'

const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`

/** The file names a browser offers that look like Mazda's download: the zip, or the loose export files. */
export function looksImportable(name: string): boolean {
  const low = name.toLowerCase()
  if (low.endsWith('.zip')) return true
  if (low.endsWith('.txt')) return name.includes('diag-tool')
  return low.endsWith('.csv') && ['_war-', '_dtc-h-', '_dtc-d-', '_dtc-ssr-', '_rts-', '_vis-', '_alt-'].some((k) => name.includes(k))
}

/** One line: how many files were new and how many the folder already had. */
export function filesLine(s: ImportSummary): string {
  const added = s.files.filter((f) => f.status === 'added').length
  const there = s.files.length - added
  if (added === 0 && s.rows_new.length > 0) return 'No new file, but rows that were not loaded yet were added.'
  if (added === 0) return `Nothing new: ${there === 1 ? 'the file was' : `all ${fmtNum(there)} files were`} already loaded.`
  return `${plural(added, 'file', 'files')} added${there > 0 ? `, ${fmtNum(there)} already loaded` : ''}.`
}

/** What the load changed, one fact per line; empty when it changed nothing. */
export function changeLines(s: ImportSummary): string[] {
  const out: string[] = []
  if (s.rows_new.length > 0) out.push(`New rows: ${s.rows_new.map((r) => `${fmtNum(r.rows)} ${r.label}`).join(', ')}.`)
  if (s.newest_day_after && s.newest_day_after !== s.newest_day_before) {
    out.push(
      s.newest_day_before
        ? `The data now reaches ${fmtDate(s.newest_day_after)} (it reached ${fmtDate(s.newest_day_before)}).`
        : `The data runs to ${fmtDate(s.newest_day_after)}.`,
    )
  }
  if (s.km_since !== null && s.km_since !== undefined && s.km_since > 0) out.push(`${distanceText(s.km_since)} driven since the load before.`)
  if (s.faults_appeared.length > 0) out.push(`In the latest fault read-out and not before: ${s.faults_appeared.join(', ')}.`)
  if (s.faults_cleared.length > 0) out.push(`No longer in the latest fault read-out: ${s.faults_cleared.join(', ')}.`)
  if (s.new_warning_codes.length > 0) {
    out.push(`${plural(s.new_warning_codes.length, 'warning code', 'warning codes')} not seen before: ${s.new_warning_codes.join(', ')}.`)
  }
  if (s.new_alerts.length > 0) out.push(`${plural(s.new_alerts.length, 'new alert', 'new alerts')}: ${s.new_alerts.join('; ')}.`)
  return out
}

/** The short form for the Overview: "Imported mazda-export.zip: 3 files added. 2 new alerts." */
export function headline(s: ImportSummary): string {
  const alerts = s.new_alerts.length > 0 ? ` ${plural(s.new_alerts.length, 'new alert', 'new alerts')}.` : ''
  return `Imported ${s.source}: ${filesLine(s).replace(/^Nothing new: /, 'nothing new, ').replace(/\.$/, '')}.${alerts}`
}

/** Whether a load brought anything (so the Overview only mentions the ones that did). */
export const changedAnything = (s: ImportSummary): boolean => s.files.some((f) => f.status === 'added') || s.rows_new.length > 0

/** Where the Overview remembers which import the reader has dismissed (per device). */
export const SEEN_KEY = 'cx5.importSeen'

export const IMPORT_NOTES = [
  "Drop the zip as Mazda sends it, or the export files themselves. Anything that is not one of Mazda's export files is refused, and so are files of another car.",
  'The files are copied into this model\'s data folder on this Mac and loaded as `make ingest` does. Nothing leaves this computer.',
  'A file that is already loaded is skipped; history is never lost. The phone app is not changed: make it a new pack afterwards.',
] as const
