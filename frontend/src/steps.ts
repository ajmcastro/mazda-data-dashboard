// Pure wording of the consumption change points (PLAN.md M65). No React in here.
// A change point says WHEN the consumption's level stepped, never why: the share of short stretches and the
// service log are shown next to it as context, never as a reason. All maths stays in l/100 km; only what is
// shown is converted (units.ts).

import { msg, tr } from './i18n'
import type { ChangePoints, ConsumptionSegment, ServiceEntry } from './api/types'
import { andList, fmtDate, fmtNum } from './lib'
import { kindLabel } from './service'
import { consumptionLabel, distanceText, fmtConsumption } from './units'

/** Service-log entries this many days either side of a change are listed next to it. */
export const NEAR_DAYS = 14

export interface Step {
  /** Around when: the start of the first stretch of the new level. */
  at: string
  before: ConsumptionSegment
  after: ConsumptionSegment
}

/** The changes between consecutive segments, oldest first. */
export function steps(cp: ChangePoints | undefined): Step[] {
  const segs = cp?.segments ?? []
  return segs.slice(1).map((after, i) => ({ at: after.from_at, before: segs[i], after }))
}

const level = (l: number) => `${fmtConsumption(l)} ${consumptionLabel()}`

/** "Around 10 Jun 2026 the consumption went from about 7.9 to about 9.2 l/100 km (2,100 km before, 2,250 km after)." */
export function stepLine(s: Step): string {
  return tr('Around {date} the consumption went from about {before} to about {after} ({kmBefore} before, {kmAfter} after).', {
    date: fmtDate(s.at),
    before: level(s.before.l_per_100km),
    after: level(s.after.l_per_100km),
    kmBefore: distanceText(s.before.km),
    kmAfter: distanceText(s.after.km),
  })
}

/** The mix of short stretches before and after, or null when either is unknown. */
export function mixLine(s: Step, stretchKm: number): string | null {
  if (s.before.short_pct == null || s.after.short_pct == null) return null
  return tr('Stretches under {km}: {before}% before, {after}% after.', {
    km: distanceText(stretchKm),
    before: fmtNum(s.before.short_pct, 0),
    after: fmtNum(s.after.short_pct, 0),
  })
}

/** Service-log entries within NEAR_DAYS of the change, as a line, or null. */
export function serviceLine(s: Step, entries: ServiceEntry[] | undefined): string | null {
  const t = Date.parse(s.at)
  const near = (entries ?? [])
    .filter((e) => Math.abs(Date.parse(`${e.date}T12:00:00Z`) - t) <= NEAR_DAYS * 86_400_000)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!near.length) return null
  return tr('In the service log around then: {entries}.', {
    entries: andList(near.map((e) => tr('{kind} on {date}', { kind: kindLabel(e.kind), date: fmtDate(e.date) }))),
  })
}

/** The headline of the panel. */
export function summaryLine(cp: ChangePoints | undefined): string | null {
  if (!cp) return null
  if (!cp.enough) {
    return tr('Too little driving to look for a change in consumption yet (at least {n} stretches and {km} on each side).', {
      n: cp.min_stretches,
      km: distanceText(cp.min_km),
    })
  }
  const n = steps(cp).length
  if (n === 0) {
    const only = cp.segments[0]
    return tr('No step in consumption stands out over all the data: about {level} over {km} in {n} stretches.', {
      level: only ? level(only.l_per_100km) : '—',
      km: distanceText(cp.km),
      n: fmtNum(cp.stretches),
    })
  }
  return n === 1
    ? tr('The consumption stepped once over all the data.')
    : tr('The consumption stepped {n} times over all the data.', { n })
}

/** How it is worked out, for the note under the panel. */
export const STEPS_NOTE = msg(
  'Found in all the data: each stretch of {stretch} or more between two status reports less than two days apart, its consumption weighted by its distance, is cut where the level steps by {step} or more with at least {n} stretches and {km} on each side, and only when the step is clearly larger than the stretches’ own ups and downs. It says when, not why: the share of short stretches and the service log are shown as context.',
)
