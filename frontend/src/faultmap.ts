// The fault map (PLAN.md M59): the car's control units where the OWNER placed them, lit by their faults.
// Pure: no React. A unit is drawn only where `layout.yaml` puts it; a unit with faults and no place is listed
// as "not placed" with the line to add, never guessed onto the car.

import { msg, tr, trn } from './i18n'
import type { DtcFrequency, ModelUnit } from './api/types'

/** The zones a unit can be put in, with their place in a plan view of the car (fractions: along from the
 *  front, across from the left). Keep equal to ZONES in backend/src/mazda_dash/models.py (a test reads it). */
export const ZONES: Record<string, { along: number; across: number; label: string }> = {
  'engine bay': { along: 0.13, across: 0.5, label: msg('Engine bay') },
  dashboard: { along: 0.31, across: 0.5, label: msg('Dashboard') },
  'under front seats': { along: 0.47, across: 0.5, label: msg('Under the front seats') },
  roof: { along: 0.62, across: 0.5, label: msg('Roof') },
  rear: { along: 0.87, across: 0.5, label: msg('Rear') },
}

export type UnitState = 'active' | 'past' | 'quiet'

export interface MapUnit {
  ecu: string
  title: string | null
  /** fractions of the car in a plan view: along from the front, across from the left */
  along: number
  across: number
  /** where the owner put it, in words: a zone's name, or "placed by position" */
  where: string
  source: string | null
  state: UnitState
  /** faults of this unit: in the latest read-out, and seen in the period but not listed now */
  active: number
  past: number
}

export interface Unplaced {
  ecu: string
  title: string | null
  active: number
  past: number
  /** the line to add under `units:` in layout.yaml */
  line: string
}

export interface FaultMap {
  units: MapUnit[]
  unplaced: Unplaced[]
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))

/** The placed units with their faults, and the units that have faults but no place. */
export function faultMap(layout: readonly ModelUnit[] | undefined, faults: readonly DtcFrequency[] | undefined): FaultMap {
  const byEcu = new Map<string, { title: string | null; active: number; past: number }>()
  for (const f of faults ?? []) {
    const u = byEcu.get(f.ecu) ?? { title: f.ecu_title ?? null, active: 0, past: 0 }
    if (f.active_in_latest_readout) u.active += 1
    else u.past += 1
    byEcu.set(f.ecu, u)
  }
  // units sharing a zone are spread across the car, in the order of the file, so they do not sit on each other
  const inZone = new Map<string, string[]>()
  for (const u of layout ?? []) if (u.zone && ZONES[u.zone]) inZone.set(u.zone, [...(inZone.get(u.zone) ?? []), u.ecu])
  const units: MapUnit[] = []
  for (const u of layout ?? []) {
    const seen = byEcu.get(u.ecu)
    let along: number
    let across: number
    let where: string
    if (u.at && u.at.length >= 2) {
      ;[along, across] = [clamp(u.at[0]), clamp(u.at[1])]
      where = tr('placed by position')
    } else if (u.zone && ZONES[u.zone]) {
      const mates = inZone.get(u.zone)!
      const i = mates.indexOf(u.ecu)
      along = ZONES[u.zone].along
      across = mates.length === 1 ? 0.5 : 0.22 + (0.56 * i) / (mates.length - 1)
      where = tr(ZONES[u.zone].label)
    } else continue // a zone this app does not know: not drawn rather than drawn somewhere
    units.push({
      ecu: u.ecu, title: seen?.title ?? null, along, across, where, source: u.source ?? null,
      state: seen?.active ? 'active' : seen?.past ? 'past' : 'quiet', active: seen?.active ?? 0, past: seen?.past ?? 0,
    })
  }
  const placed = new Set(units.map((u) => u.ecu))
  const unplaced = [...byEcu]
    .filter(([ecu]) => !placed.has(ecu))
    .sort((a, b) => b[1].active - a[1].active || a[0].localeCompare(b[0]))
    .map(([ecu, u]) => ({ ecu, title: u.title, active: u.active, past: u.past, line: `  ${ecu}: {zone: engine bay, source: "where you learned it"}` }))
  return { units, unplaced }
}

/** "2 active, 1 past", "1 past fault", "no fault in this period" */
export function faultsText(u: { active: number; past: number }): string {
  const parts: string[] = []
  if (u.active) parts.push(tr('{n} active', { n: u.active }))
  if (u.past) parts.push(tr('{n} past', { n: u.past }))
  if (parts.length === 0) return tr('no fault in this period')
  return trn('{what} fault', '{what} faults', u.active + u.past, { what: parts.join(', ') })
}

export const FAULT_MAP_NOTES = [
  msg('A unit is drawn only where you placed it in layout.yaml. Nothing is guessed: a unit without a place is listed, not drawn.'),
  msg('A zone is an area of the car, not a spot: units in the same zone are spread across it so they can be told apart.'),
  msg('Lit: a fault in the latest read-out. Dim: faults seen in the period but not listed now.'),
] as const
