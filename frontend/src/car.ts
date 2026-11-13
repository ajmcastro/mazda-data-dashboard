// What the car's latest status reports say, part by part (PLAN.md M38). No React and no 3D in here: the list
// panel shows this as it is and the 3D scene (M39) draws the same parts, so the two can never disagree.
// Nothing is interpreted beyond what the other panels already assume: a door value of 0 is "closed", any other
// value is "open", a value the car flagged Invalid (null here) stays "unknown", and no pressure or fuel limit is
// invented (a wheel is marked only by the car's own flag or the "clearly the lowest" rule of the tire drawing).

import type { CarWarningFlag, CarWarnings, DoorPoint, OilService, Overview } from './api/types'
import { fmtAge, fmtDateTime, fmtNum, OIL_SOON_KM } from './lib'

export type PartId =
  | 'wheel_fl' | 'wheel_fr' | 'wheel_rl' | 'wheel_rr'
  | 'door_driver' | 'door_passenger' | 'door_rear_left' | 'door_rear_right'
  | 'trunk' | 'hood' | 'fuel' | 'engine' | 'dash'

/** `absent` = this car does not send it (the part gets no label); `unknown` = sent, but not usable now. */
export type PartState = 'ok' | 'attention' | 'open' | 'unknown' | 'absent'

export type PartGroup = 'wheels' | 'doors' | 'other'

export interface Part {
  id: PartId
  name: string
  group: PartGroup
  state: PartState
  /** The figure shown next to the part, e.g. "230 kPa", "closed", "62 %". */
  value: string
  /** Further lines of the label, most important first. */
  notes: string[]
  /** When the car reported it (ISO, UTC), when known. */
  at: string | null
  /** The figure is an old one the car kept showing (stale tire measurement). */
  old: boolean
}

export interface CarState {
  /** Every part, always in the same order, `absent` ones included. */
  parts: Part[]
  /** False when no part has anything to show (an empty period or database). */
  hasData: boolean
  /** Time of the status snapshot most figures come from. */
  asOf: string | null
}

/** A wheel is "clearly the lowest" when it is the lowest and this far (kPa) under the highest: the rule of `Tires.tsx`. */
export const LOWEST_SPREAD_KPA = 20

export const CAR_NOTES = [
  'A door value of 0 is assumed to mean closed; any other value is shown as open with the raw value.',
  'Lock codes are shown raw: their meaning is not documented.',
  'Fuel, tires, doors and the odometer are the newest in the selected period; the warning flags and the oil countdown are the car\'s latest.',
] as const

const WHEELS: { id: PartId; name: string; key: 'tire_fl_kpa' | 'tire_fr_kpa' | 'tire_rl_kpa' | 'tire_rr_kpa'; flag: string }[] = [
  { id: 'wheel_fl', name: 'Front left wheel', key: 'tire_fl_kpa', flag: 'fltyrepresswarn' },
  { id: 'wheel_fr', name: 'Front right wheel', key: 'tire_fr_kpa', flag: 'frtyrepresswarn' },
  { id: 'wheel_rl', name: 'Rear left wheel', key: 'tire_rl_kpa', flag: 'rltyrepresswarn' },
  { id: 'wheel_rr', name: 'Rear right wheel', key: 'tire_rr_kpa', flag: 'rrtyrepresswarn' },
]

const DOORS: { id: PartId; name: string; key: 'door_driver' | 'door_passenger' | 'door_rear_left' | 'door_rear_right' | 'trunk' | 'hood'; lock?: 'lock_driver' | 'lock_passenger' }[] = [
  { id: 'door_driver', name: 'Driver door', key: 'door_driver', lock: 'lock_driver' },
  { id: 'door_passenger', name: 'Passenger door', key: 'door_passenger', lock: 'lock_passenger' },
  { id: 'door_rear_left', name: 'Rear left door', key: 'door_rear_left' },
  { id: 'door_rear_right', name: 'Rear right door', key: 'door_rear_right' },
  { id: 'trunk', name: 'Trunk', key: 'trunk' },
  { id: 'hood', name: 'Hood', key: 'hood' },
]

/** The car's flags that belong to one part; every other flag that is on is listed at the dashboard. */
const OIL_FLAG = 'oillevelwarning'
const PART_FLAGS = new Set([...WHEELS.map((w) => w.flag), OIL_FLAG])

const num = (v: number | null | undefined): v is number => typeof v === 'number' && !Number.isNaN(v)

function wheels(o: Overview | undefined, flags: Map<string, CarWarningFlag>): Part[] {
  const s = o?.status
  const values = WHEELS.map((w) => s?.[w.key]).filter(num)
  const lowest = values.length ? Math.min(...values) : null
  const spread = values.length ? Math.max(...values) - Math.min(...values) : 0
  // a car that has never sent a pressure nor a tire flag has no tire sensors to show
  const sends = values.length > 0 || WHEELS.some((w) => flags.has(w.flag))
  return WHEELS.map((w) => {
    const v = s?.[w.key]
    const flag = flags.get(w.flag)
    const notes: string[] = []
    let state: PartState = !sends ? 'absent' : num(v) ? 'ok' : 'unknown'
    if (flag?.is_on) {
      state = 'attention'
      notes.push(`the car's tire flag is on (raw ${fmtNum(flag.value)})`)
    }
    if (num(v) && v === lowest && spread >= LOWEST_SPREAD_KPA) {
      state = 'attention'
      notes.push(`lowest of the four, ${fmtNum(spread)} kPa under the highest`)
    }
    const old = num(v) && s?.tire_stale === true
    if (num(v) && s?.tire_measured_at) {
      notes.push(
        old
          ? `old reading: measured ${fmtDateTime(s.tire_measured_at)}, ${fmtAge(s.tire_age_minutes)} before this snapshot`
          : `measured ${fmtDateTime(s.tire_measured_at)}`,
      )
    } else if (num(v)) notes.push('measurement time unknown')
    return {
      id: w.id, name: w.name, group: 'wheels', state, old,
      value: num(v) ? fmtNum(v, 0, 'kPa') : state === 'absent' ? 'not sent' : 'unknown',
      notes,
      at: num(v) ? (s?.tire_measured_at ?? s?.at ?? null) : (flag?.last_read_at ?? null),
    }
  })
}

function doors(d: DoorPoint | undefined): Part[] {
  return DOORS.map((def) => {
    if (!d) return { id: def.id, name: def.name, group: 'doors', state: 'absent', value: 'not sent', notes: [], at: null, old: false }
    const v = d[def.key]
    const notes: string[] = []
    if (def.lock && num(d[def.lock])) notes.push(`lock code ${fmtNum(d[def.lock])}`)
    return {
      id: def.id, name: def.name, group: 'doors', old: false, at: d.created_at, notes,
      state: !num(v) ? 'unknown' : v === 0 ? 'ok' : 'open',
      value: !num(v) ? 'unknown' : v === 0 ? 'closed' : `open (raw ${fmtNum(v)})`,
    }
  })
}

function fuel(o: Overview | undefined): Part {
  const s = o?.status
  const level = s?.fuel_level_pct
  const notes = num(s?.range_km) ? [`range ${fmtNum(s.range_km, 0, 'km')}`] : []
  return {
    id: 'fuel', name: 'Fuel tank', group: 'other', old: false, notes, at: num(level) ? (s?.at ?? null) : null,
    state: num(level) ? 'ok' : 'absent',
    value: num(level) ? `${fmtNum(level)} %` : 'not sent',
  }
}

function engine(oil: OilService | undefined, flags: Map<string, CarWarningFlag>): Part {
  const flag = flags.get(OIL_FLAG)
  const km = oil?.has_data ? oil.remaining_km : null
  const notes: string[] = []
  let state: PartState = num(km) || flag ? 'ok' : 'absent'
  if (flag?.is_on) {
    state = 'attention'
    notes.push(`the car's oil level flag is on (raw ${fmtNum(flag.value)})`)
  }
  if (num(km)) {
    if (km <= OIL_SOON_KM) {
      state = 'attention'
      notes.push('oil change due soon')
    }
    notes.push("the car's own countdown, in steps of 1,000 km or more")
    if (num(oil?.km_since_reading) && oil.km_since_reading >= 50) notes.push(`${fmtNum(oil.km_since_reading)} km driven since`)
  }
  return {
    id: 'engine', name: 'Engine', group: 'other', state, old: false, notes,
    value: num(km) ? `${fmtNum(km)} km to oil change` : flag ? (flag.is_on ? 'oil level flag on' : 'oil level flag clear') : 'not sent',
    at: num(km) ? (oil?.read_at ?? null) : (flag?.last_read_at ?? null),
  }
}

function dash(o: Overview | undefined, flags: Map<string, CarWarningFlag>): Part {
  const on = [...flags.values()].filter((f) => f.is_on && !PART_FLAGS.has(f.flag))
  const km = o?.odometer_km
  return {
    id: 'dash', name: 'Dashboard', group: 'other', old: false,
    state: on.length ? 'attention' : num(km) ? 'ok' : 'absent',
    value: num(km) ? fmtNum(km, 0, 'km') : on.length ? 'warning on' : 'not sent',
    notes: on.map((f) => `flag on: ${f.label} (raw ${fmtNum(f.value)})`),
    at: num(km) ? (o?.odometer_at ?? null) : (on[0]?.last_read_at ?? null),
  }
}

/** The car, part by part, from the answers of the four endpoints the panel reads (any of them may be missing). */
export function carState(
  overview: Overview | undefined,
  door: DoorPoint | undefined,
  oil: OilService | undefined,
  carWarnings: CarWarnings | undefined,
): CarState {
  const flags = new Map((carWarnings?.has_data ? carWarnings.flags : []).map((f) => [f.flag, f]))
  const parts = [...wheels(overview, flags), ...doors(door), fuel(overview), engine(oil, flags), dash(overview, flags)]
  return {
    parts,
    hasData: parts.some((p) => p.state !== 'absent'),
    asOf: overview?.status.at ?? door?.created_at ?? null,
  }
}

/** The parts to list (those the car sends), by group. */
export function listedParts(car: CarState, group: PartGroup): Part[] {
  return car.parts.filter((p) => p.group === group && p.state !== 'absent')
}

/** The word on a part's badge; null for a part with nothing to remark (an unknown part says so as its value). */
export function stateBadge(p: Part): { kind: 'critical' | 'warning'; text: string } | null {
  if (p.state === 'attention') return { kind: 'critical', text: 'check' }
  if (p.state === 'open') return { kind: 'warning', text: 'open' }
  if (p.old) return { kind: 'warning', text: 'old reading' }
  return null
}

/** One sentence above the list. */
export function carHeadline(car: CarState): string {
  if (!car.hasData) return 'No status report in this period.'
  const shown = car.parts.filter((p) => p.state !== 'absent')
  const attention = shown.filter((p) => p.state === 'attention')
  const open = shown.filter((p) => p.state === 'open')
  const unknown = shown.filter((p) => p.state === 'unknown')
  const names = (ps: Part[]) => ps.map((p) => p.name.toLowerCase()).join(', ')
  const said: string[] = []
  if (attention.length) said.push(`To check: ${names(attention)}.`)
  if (open.length) said.push(`Open: ${names(open)}.`)
  if (unknown.length) said.push(`Unknown: ${names(unknown)}.`)
  return said.length ? said.join(' ') : 'Nothing to remark in the latest reports.'
}

// ---- how the panel is shown ----

export type CarView = '3d' | 'list'
export const CAR_VIEW_KEY = 'cx5.car-view'

/** The remembered choice; anything but "list" means the 3D view. */
export const parseCarView = (value: unknown): CarView => (value === 'list' ? 'list' : '3d')

/**
 * What the panel shows: the 3D view only when it was chosen, the screen is wide enough for labels beside the car
 * and nothing went wrong drawing it. `failed` is the reason the 3D view gave up, if it did.
 */
export function carView(choice: CarView, wide: boolean, failed: string | null): CarView {
  return choice === '3d' && wide && !failed ? '3d' : 'list'
}
