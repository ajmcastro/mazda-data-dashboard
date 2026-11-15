// Pure wording of the import page (PLAN.md M53). No React in here.
// It says what one load changed, in counts and names from the server; it never interprets a fault or a code.

import { msg, tr, trn } from './i18n'
import type { ImportSummary } from './api/types'
import { fmtDate, fmtNum } from './lib'
import { distanceText } from './units'
import { alertTitle } from './alerttext'


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
  return `${filesText(s, added, there)}.`
}

/** The same without its full stop; `lower` starts it in lower case, for the middle of a sentence. */
function filesText(s: ImportSummary, added: number, there: number, lower = false): string {
  if (added === 0 && s.rows_new.length > 0) return tr('No new file, but rows that were not loaded yet were added')
  if (added === 0) {
    if (there === 1) return lower ? tr('nothing new, the file was already loaded') : tr('Nothing new: the file was already loaded')
    return lower ? tr('nothing new, all {n} files were already loaded', { n: fmtNum(there) }) : tr('Nothing new: all {n} files were already loaded', { n: fmtNum(there) })
  }
  const already = there > 0 ? `, ${tr('{n} already loaded', { n: fmtNum(there) })}` : ''
  return `${trn('{n} file added', '{n} files added', added, { n: fmtNum(added) })}${already}`
}

/** What the load changed, one fact per line; empty when it changed nothing. */
export function changeLines(s: ImportSummary): string[] {
  const out: string[] = []
  if (s.rows_new.length > 0) out.push(tr('New rows: {list}.', { list: s.rows_new.map((r) => `${fmtNum(r.rows)} ${tr(r.label)}`).join(', ') }))
  if (s.newest_day_after && s.newest_day_after !== s.newest_day_before) {
    out.push(
      s.newest_day_before
        ? tr('The data now reaches {to} (it reached {from}).', { to: fmtDate(s.newest_day_after), from: fmtDate(s.newest_day_before) })
        : tr('The data runs to {to}.', { to: fmtDate(s.newest_day_after) }),
    )
  }
  if (s.km_since !== null && s.km_since !== undefined && s.km_since > 0) out.push(tr('{distance} driven since the load before.', { distance: distanceText(s.km_since) }))
  if (s.faults_appeared.length > 0) out.push(tr('In the latest fault read-out and not before: {codes}.', { codes: s.faults_appeared.join(', ') }))
  if (s.faults_cleared.length > 0) out.push(tr('No longer in the latest fault read-out: {codes}.', { codes: s.faults_cleared.join(', ') }))
  if (s.new_warning_codes.length > 0) {
    out.push(trn('{n} warning code not seen before: {codes}.', '{n} warning codes not seen before: {codes}.', s.new_warning_codes.length, { codes: s.new_warning_codes.join(', ') }))
  }
  if (s.new_alerts.length > 0) out.push(trn('{n} new alert: {titles}.', '{n} new alerts: {titles}.', s.new_alerts.length, { titles: s.new_alerts.map(alertTitle).join('; ') }))
  return out
}

/** The short form for the Overview: "Imported mazda-export.zip: 3 files added. 2 new alerts." */
export function headline(s: ImportSummary): string {
  const alerts = s.new_alerts.length > 0 ? ` ${trn('{n} new alert.', '{n} new alerts.', s.new_alerts.length)}` : ''
  const added = s.files.filter((f) => f.status === 'added').length
  return `${tr('Imported {source}: {what}.', { source: s.source, what: filesText(s, added, s.files.length - added, true) })}${alerts}`
}

/** Whether a load brought anything (so the Overview only mentions the ones that did). */
export const changedAnything = (s: ImportSummary): boolean => s.files.some((f) => f.status === 'added') || s.rows_new.length > 0

/** Where the Overview remembers which import the reader has dismissed (per device). */
export const SEEN_KEY = 'cx5.importSeen'

/** The names the server gives each kind of export (`KIND_LABEL` in backend/src/mazda_dash/importer.py), so they can be translated. */
export const KIND_LABELS = [
  msg('warnings'), msg('fault read-outs'), msg('faults'), msg('freeze frames'), msg('status reports'), msg('door reports'), msg('alarm reports'), msg('diagnostic reports'),
]

export const IMPORT_NOTES = [
  msg("Drop the zip as Mazda sends it, or the export files themselves. Anything that is not one of Mazda's export files is refused, and so are files of another car."),
  msg("The files are copied into this model's data folder on this Mac and loaded as `make ingest` does. Nothing leaves this computer."),
  msg('A file that is already loaded is skipped; history is never lost. The phone app is not changed: make it a new pack afterwards.'),
] as const
