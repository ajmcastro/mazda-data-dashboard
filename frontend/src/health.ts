// Pure wording and maths of the Data health page (PLAN.md M46). No React in here.
// The page describes the EXPORTS, not the car: what each file covers, where the status reports fall silent
// and which signals the car flagged Invalid. Nothing here is good or bad news about the vehicle, so the
// wording is neutral and the page uses no good/bad colours.

import { msg, tr, trn } from './i18n'
import type { DataHealth, DataKind } from './api/types'
import { fmtNum } from './lib'

/** What each kind of file is, in plain words, and the part of Mazda's file name it is recognised by. */
export const KINDS: Record<string, { label: string; file: string; unit: string }> = {
  war: { label: msg('Warnings'), file: '_war-', unit: msg('events') },
  'dtc-h': { label: msg('Fault read-outs'), file: '_dtc-h-', unit: msg('read-outs') },
  'dtc-d': { label: msg('Faults listed in read-outs'), file: '_dtc-d-', unit: msg('entries') },
  'dtc-ssr': { label: msg('Freeze frames'), file: '_dtc-ssr-', unit: msg('frames') },
  rts: { label: msg('Status reports'), file: '_rts-', unit: msg('reports') },
  vis: { label: msg('Door and lock reports'), file: '_vis-', unit: msg('reports') },
  alt: { label: msg('Alarm reports'), file: '_alt-', unit: msg('reports') },
  diag: { label: msg('Diagnostic-tool reports'), file: 'diag-tool', unit: msg('reports') },
}

export const kindLabel = (kind: string): string => tr(KINDS[kind]?.label ?? kind)

const DAY_MS = 86_400_000
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`)

/** Share of a whole in percent, to one decimal; null for nothing out of nothing. */
export const share = (part: number, whole: number): number | null => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null)

/** A silence in words: hours under two days, days from there ("11 days", with the hours kept exact elsewhere). */
export function gapLength(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—'
  if (hours < 48) return tr('{n} h', { n: fmtNum(hours, 1) })
  return tr('{n} days', { n: fmtNum(hours / 24, 1) })
}

/**
 * Where a kind's first and last record fall in the days looked at, as percentages of the strip's width
 * (null for a kind with nothing, or when the days are unknown). A single record still gets a visible sliver.
 */
export function coverageBar(kind: Pick<DataKind, 'first_at' | 'last_at'>, h: Pick<DataHealth, 'range_from' | 'range_to'>): { left: number; width: number } | null {
  if (!kind.first_at || !kind.last_at || !h.range_from || !h.range_to) return null
  const start = dayStart(h.range_from)
  const span = dayStart(h.range_to) + DAY_MS - start
  if (span <= 0) return null
  const clamp = (v: number) => Math.min(100, Math.max(0, v))
  const left = clamp(((Date.parse(kind.first_at) - start) / span) * 100)
  const right = clamp(((Date.parse(kind.last_at) - start) / span) * 100)
  return { left: Math.min(left, 99), width: Math.max(1, right - left) }
}

/** The headline: how many of the days have a status report, and the longest silence. */
export function coverageLine(h: DataHealth | undefined): string | null {
  if (!h) return null
  if (!h.has_data) return tr('No data in this period.')
  if (h.snapshots === 0) return tr('The car sent no status report in this period, so fuel, tires and trips have nothing to show here.')
  const days = trn('Status reports cover {n} of {total} day', 'Status reports cover {n} of {total} days', h.days_in_range, { n: fmtNum(h.days_with_status), total: fmtNum(h.days_in_range) })
  if (h.longest_gap_hours === null || h.longest_gap_hours === undefined) return `${days}.`
  return `${days}; ${tr('the longest silence between two of them was {gap}', { gap: gapLength(h.longest_gap_hours) })}.`
}

/** How far apart the reports usually are, and what that means for everything measured between two of them. */
export function usualLine(h: DataHealth | undefined): string | null {
  if (!h || h.median_gap_hours === null || h.median_gap_hours === undefined) return null
  return tr('Half of the status reports arrive within {gap} of the one before. Trips, fuel use and anything else measured between two reports is only as fine as that.', {
    gap: gapLength(h.median_gap_hours),
  })
}

/** How many gaps there are beyond the ones listed. */
export function gapsNote(h: DataHealth): string | null {
  if (h.gaps_total === 0) return tr('No silence of {n} hours or more in this period.', { n: fmtNum(h.gap_threshold_hours) })
  const more = h.gaps_total - h.gaps.length
  return more > 0 ? tr('The {n} longest of {total} are listed.', { n: fmtNum(h.gaps.length), total: fmtNum(h.gaps_total) }) : null
}

/** What the car flagged Invalid, and what the dashboard does about it. */
export function invalidLine(h: DataHealth | undefined): string | null {
  if (!h || h.readings_checked === 0) return null
  if (h.invalid_readings === 0) return tr('None of the {n} readings the dashboard uses was flagged Invalid by the car.', { n: fmtNum(h.readings_checked) })
  const pct = share(h.invalid_readings, h.readings_checked)
  return tr('The car flagged {n} of {total} readings as Invalid{pct}, in {signals} of {checked} signals. An Invalid reading is never used: it shows as unknown, not as a value.', {
    n: fmtNum(h.invalid_readings), total: fmtNum(h.readings_checked),
    pct: pct === null ? '' : ` (${pct < 0.1 ? tr('under 0.1') : fmtNum(pct, 1)}%)`,
    signals: fmtNum(h.invalid.length), checked: fmtNum(h.signals_checked),
  })
}

export const HEALTH_NOTE =
  msg('This page is about the exports, not about the car. A silence means no report was sent or exported for that time; it says nothing about whether the car was driven.')
