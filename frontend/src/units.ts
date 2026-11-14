// The units figures are shown in (PLAN.md M45): pressure, fuel consumption and distance. A choice per device,
// like the theme, kept in localStorage; the API, the database and all the maths stay in kPa, l/100 km and km,
// and a figure is converted only where it is shown. Everything that shows such a figure goes through here.
//
// The current choice is module state (`getUnits()`), so the pure wording modules can format without being
// handed it; both apps remount their pages when it changes (`useUnits()` in App), so nothing stale stays.

import { useSyncExternalStore } from 'react'
import { fmtNum } from './lib'

export type PressureUnit = 'kPa' | 'bar' | 'psi'
export type ConsumptionUnit = 'l/100km' | 'km/l' | 'mpg-uk' | 'mpg-us'
export type DistanceUnit = 'km' | 'mi'

export interface Units {
  pressure: PressureUnit
  consumption: ConsumptionUnit
  distance: DistanceUnit
}

/** What the data is in. */
export const DEFAULT_UNITS: Units = { pressure: 'kPa', consumption: 'l/100km', distance: 'km' }
export const UNITS_KEY = 'cx5.units'

export const PRESSURE_UNITS: readonly PressureUnit[] = ['kPa', 'bar', 'psi']
export const CONSUMPTION_UNITS: readonly ConsumptionUnit[] = ['l/100km', 'km/l', 'mpg-uk', 'mpg-us']
export const DISTANCE_UNITS: readonly DistanceUnit[] = ['km', 'mi']

const KM_PER_MILE = 1.609344
const KPA_PER_PSI = 6.894757
const LITRES_PER_UK_GALLON = 4.54609
const LITRES_PER_US_GALLON = 3.785411784

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)

/** A stored choice, tolerant of anything: an unknown or missing unit is the default one. */
export function parseUnits(value: unknown): Units {
  let raw: Record<string, unknown> = {}
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>
  } catch {
    /* not JSON: the defaults */
  }
  return {
    pressure: oneOf(PRESSURE_UNITS, raw.pressure, DEFAULT_UNITS.pressure),
    consumption: oneOf(CONSUMPTION_UNITS, raw.consumption, DEFAULT_UNITS.consumption),
    distance: oneOf(DISTANCE_UNITS, raw.distance, DEFAULT_UNITS.distance),
  }
}

function read(): Units {
  try {
    return parseUnits(localStorage.getItem(UNITS_KEY))
  } catch {
    return DEFAULT_UNITS // no storage (private mode, tests): the choice just lasts for this visit
  }
}

let current: Units = read()
const listeners = new Set<() => void>()

export const getUnits = (): Units => current

export function setUnits(next: Units): void {
  current = parseUnits(next)
  try {
    const same = (Object.keys(DEFAULT_UNITS) as (keyof Units)[]).every((k) => current[k] === DEFAULT_UNITS[k])
    if (same) localStorage.removeItem(UNITS_KEY)
    else localStorage.setItem(UNITS_KEY, JSON.stringify(current))
  } catch {
    /* not remembered */
  }
  listeners.forEach((fn) => fn())
}

export function useUnits(): [Units, (next: Units) => void] {
  const units = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
  return [units, setUnits]
}

/** Changes whenever the units do: a React key for what must be drawn again. */
export const unitsKey = (u: Units = current): string => `${u.pressure}|${u.consumption}|${u.distance}`

// ---- converting (from what the data is in) ----

type Maybe = number | null | undefined
const known = (v: Maybe): v is number => typeof v === 'number' && !Number.isNaN(v)

export function toPressure(kpa: Maybe, u: Units = current): number | null {
  if (!known(kpa)) return null
  return u.pressure === 'bar' ? kpa / 100 : u.pressure === 'psi' ? kpa / KPA_PER_PSI : kpa
}

export function toDistance(km: Maybe, u: Units = current): number | null {
  if (!known(km)) return null
  return u.distance === 'mi' ? km / KM_PER_MILE : km
}

/** km/h to mph when distances are in miles. */
export const toSpeed = (kmh: Maybe, u: Units = current): number | null => toDistance(kmh, u)

/** An amount per 100 km (a cost) to the amount per 100 of the distance unit. */
export function toPer100(per100km: Maybe, u: Units = current): number | null {
  if (!known(per100km)) return null
  return u.distance === 'mi' ? per100km * KM_PER_MILE : per100km
}

/**
 * l/100 km to the chosen unit. The other three are distance per fuel, so they turn the figure upside down:
 * a consumption of zero or less (no fuel used, or a counter that ran backwards) has no value there.
 */
export function toConsumption(lPer100km: Maybe, u: Units = current): number | null {
  if (!known(lPer100km)) return null
  if (u.consumption === 'l/100km') return lPer100km
  if (lPer100km <= 0) return null
  const kmPerLitre = 100 / lPer100km
  if (u.consumption === 'km/l') return kmPerLitre
  return (kmPerLitre / KM_PER_MILE) * (u.consumption === 'mpg-uk' ? LITRES_PER_UK_GALLON : LITRES_PER_US_GALLON)
}

/** With km/l or mpg a HIGHER figure means less fuel: what is good and bad turns round. */
export const consumptionHigherIsBetter = (u: Units = current): boolean => u.consumption !== 'l/100km'

// ---- naming ----

export const pressureLabel = (u: Units = current): string => u.pressure
export const distanceLabel = (u: Units = current): string => u.distance
export const speedLabel = (u: Units = current): string => (u.distance === 'mi' ? 'mph' : 'km/h')
export const CONSUMPTION_LABEL: Record<ConsumptionUnit, string> = {
  'l/100km': 'l/100 km', 'km/l': 'km/l', 'mpg-uk': 'mpg (UK)', 'mpg-us': 'mpg (US)',
}
export const consumptionLabel = (u: Units = current): string => CONSUMPTION_LABEL[u.consumption]
/** "per 100 km" or "per 100 mi". */
export const per100Label = (u: Units = current): string => `100 ${u.distance}`

/** Decimals that make sense in each unit: 245 kPa, 2.45 bar, 35.5 psi. */
export const pressureDigits = (u: Units = current): number => (u.pressure === 'bar' ? 2 : u.pressure === 'psi' ? 1 : 0)
/** `base` is what the page uses for l/100 km; the others read well with one decimal. */
export const consumptionDigits = (base = 1, u: Units = current): number => (u.consumption === 'l/100km' ? base : 1)

// ---- formatting ("—" for a missing value, as fmtNum) ----

export const fmtPressure = (kpa: Maybe, withUnit = true, u: Units = current): string =>
  fmtNum(toPressure(kpa, u), pressureDigits(u), withUnit && known(kpa) ? pressureLabel(u) : '')

export const fmtDistance = (km: Maybe, digits = 0, withUnit = true, u: Units = current): string =>
  fmtNum(toDistance(km, u), digits, withUnit && known(km) ? distanceLabel(u) : '')

export const fmtConsumption = (lPer100km: Maybe, baseDigits = 1, withUnit = false, u: Units = current): string => {
  const v = toConsumption(lPer100km, u)
  return fmtNum(v, consumptionDigits(baseDigits, u), withUnit && v !== null ? consumptionLabel(u) : '')
}

/** The same inside a sentence ("5,307 km driven since"): an ordinary space before the unit, so the text can wrap. */
export const distanceText = (km: Maybe, digits = 0, u: Units = current): string =>
  known(km) ? `${fmtDistance(km, digits, false, u)} ${distanceLabel(u)}` : '—'
export const pressureText = (kpa: Maybe, u: Units = current): string =>
  known(kpa) ? `${fmtPressure(kpa, false, u)} ${pressureLabel(u)}` : '—'

export const fmtSpeed = (kmh: Maybe, digits = 0, u: Units = current): string =>
  fmtNum(toSpeed(kmh, u), digits, known(kmh) ? speedLabel(u) : '')
