// Pure logic and wording of the service log (PLAN.md M50). No React in here.
// An entry is what the OWNER noted; a suggestion is what the data hints at and is never added by itself.

import { msg, tr } from './i18n'
import type { ServiceEntry, ServiceSuggestion } from './api/types'
import { fmtDate } from './lib'
import { distanceText } from './units'

export const KIND_LABEL: Record<string, string> = {
  oil_change: msg('oil change'), tires: msg('tires'), service: msg('service'), software: msg('software'), repair: msg('repair'), other: msg('other'),
}
export const kindLabel = (kind: string): string => tr(KIND_LABEL[kind] ?? kind)

/** Why something is suggested, in a few words. */
export function suggestionText(s: ServiceSuggestion): string {
  const what = s.reason === 'oil_countdown' ? tr('The oil countdown went up') : s.reason === 'diagnostic_report' ? tr('A diagnostic report was taken') : tr('Something was seen')
  const km = s.odometer_km === null || s.odometer_km === undefined ? '' : ` ${tr('at {distance}', { distance: distanceText(s.odometer_km) })}`
  const hint =
    s.reason === 'oil_countdown' ? tr('it looks like an oil change by then') : s.reason === 'diagnostic_report' ? tr('it looks like a visit to a workshop') : tr('it may be worth noting')
  return `${what} ${tr('on {date}', { date: fmtDate(s.date) })}${km}: ${hint}.`
}

export interface Draft {
  date: string
  kind: string
  note: string
  /** as typed; empty = not given */
  odometer: string
}

export const EMPTY_DRAFT: Draft = { date: '', kind: 'service', note: '', odometer: '' }

/** A suggestion as the start of an entry: the note is left to the owner. */
export const draftFrom = (s: ServiceSuggestion): Draft => ({
  date: s.date, kind: s.kind, note: '', odometer: s.odometer_km === null || s.odometer_km === undefined ? '' : String(Math.round(s.odometer_km)),
})

/** What is wrong with a draft, in words; an empty list means it can be sent. */
export function problems(d: Draft, kinds: readonly string[]): string[] {
  const out: string[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(Date.parse(`${d.date}T00:00:00Z`))) out.push(tr('Pick the day it was done.'))
  if (!kinds.includes(d.kind)) out.push(tr('Pick what kind of work it was.'))
  const note = d.note.trim()
  if (!note) out.push(tr('Write a short note of what was done.'))
  else if (note.length > 200) out.push(tr('The note is too long (200 characters at most).'))
  if (d.odometer.trim() !== '') {
    const km = Number(d.odometer)
    if (!Number.isFinite(km) || km < 0 || km > 2_000_000) out.push(tr('The odometer must be a number of kilometres, or left empty.'))
  }
  return out
}

/** A draft as the entry the API takes (the odometer is always sent in kilometres, as the log stores it). */
export const toEntry = (d: Draft): ServiceEntry => ({
  date: d.date, kind: d.kind, note: d.note.trim(), odometer_km: d.odometer.trim() === '' ? null : Number(d.odometer),
})

/** The line to paste into service_log.yaml (the same form the dashboard writes). */
export function yamlLine(e: Pick<ServiceEntry, 'date' | 'kind' | 'note' | 'odometer_km'>): string {
  const km = e.odometer_km === null || e.odometer_km === undefined ? '' : `, odometer_km: ${Math.round(e.odometer_km)}`
  return `- {date: ${e.date}, kind: ${e.kind}, note: ${JSON.stringify(e.note || '…')}${km}}`
}

/** Noon of the entry's day on the charts' time axis (an entry has a day, not a moment). */
export const markerTime = (date: string): number => Date.parse(`${date}T12:00:00`)

export interface Marker {
  t: number
  label: string
  title: string
}

/** The entries as marks for a time chart whose data runs from `from` to `to` (ms): only those inside it. */
export function markers(entries: readonly ServiceEntry[] | undefined, from: number | undefined, to: number | undefined): Marker[] {
  if (!entries || from === undefined || to === undefined) return []
  return entries
    .map((e) => ({ t: markerTime(e.date), label: kindLabel(e.kind), title: `${fmtDate(e.date)}: ${e.note}` }))
    .filter((m) => m.t >= from && m.t <= to)
    .sort((a, b) => a.t - b.t)
}

/** The first and last time of a chart's points. */
export function extent(points: readonly { t: number }[] | undefined): [number | undefined, number | undefined] {
  if (!points || points.length === 0) return [undefined, undefined]
  let lo = points[0].t
  let hi = points[0].t
  for (const p of points) {
    if (p.t < lo) lo = p.t
    if (p.t > hi) hi = p.t
  }
  return [lo, hi]
}
