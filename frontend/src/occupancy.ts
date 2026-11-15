// Pure wording and maths of the "Who rides" panel on Status (PLAN.md M37). No React in here.
// The base of every share is the status snapshots with the DRIVER's belt buckled (the car is being used), so a
// snapshot while parked does not count as "driving alone". These are snapshots, not trips, and the front and
// rear shares can overlap, so they do not add up to 100 %.

import type { Occupancy } from './api/types'

/** A month with fewer belted snapshots than this is marked: a share of a handful is not a trend. */
export const MIN_READINGS = 5

export const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((100 * part) / whole) : null

export interface Share {
  key: 'driver_only' | 'passenger' | 'rear'
  label: string
  readings: number
  pct: number | null
}

export function shares(o: Occupancy | undefined): Share[] {
  if (!o || !o.available) return []
  return [
    { key: 'driver_only', label: 'Driver only', readings: o.driver_only_readings, pct: pct(o.driver_only_readings, o.belted_readings) },
    { key: 'passenger', label: 'Front passenger belted', readings: o.passenger_readings, pct: pct(o.passenger_readings, o.belted_readings) },
    { key: 'rear', label: 'A rear seat belted', readings: o.rear_readings, pct: pct(o.rear_readings, o.belted_readings) },
  ]
}

export interface MonthBar {
  month: string
  /** Share of the month's belted snapshots with anyone else belted (front or rear is not summed: see rearOf). */
  passengerPct: number | null
  rearPct: number | null
  belted: number
  few: boolean
}

export function monthBars(o: Occupancy | undefined): MonthBar[] {
  return (o?.months ?? []).map((m) => ({
    month: m.month,
    passengerPct: pct(m.passenger_readings, m.belted_readings),
    rearPct: pct(m.rear_readings, m.belted_readings),
    belted: m.belted_readings,
    few: m.belted_readings < MIN_READINGS,
  }))
}

/** One neutral sentence, or null when there is nothing to say. */
export function summaryLine(o: Occupancy | undefined): string | null {
  if (!o || !o.available || o.belted_readings === 0) return null
  const driver = pct(o.driver_only_readings, o.belted_readings)
  const front = pct(o.passenger_readings, o.belted_readings)
  return `In ${o.belted_readings} status snapshots with the driver’s belt buckled: driver only in ${driver}%, a front passenger belted in ${front}%.`
}

export const OCCUPANCY_NOTE =
  'Counted over status snapshots with the driver’s belt buckled, not over trips, and from seat belts only: a passenger ' +
  'who does not buckle up is not seen. The front and rear shares can overlap.'

// ------------------------------------------------------------------ the seats (M57)

export type SeatId = 'driver' | 'passenger' | 'rear_left' | 'rear_right'

export interface Seat {
  id: SeatId
  label: string
  /** where it is drawn in a plan view of the car, front at the top: 0 = left column, 1 = right; row 0 = front */
  column: 0 | 1
  row: 0 | 1
  /** share of the snapshots with the driver belted in which this seat's belt was buckled; the driver's is the base */
  pct: number | null
  readings: number
}

/** The four seats with their share. The driver sits on the side the model says (`steering`); the data's "rear left" and "rear right" are the car's own left and right. */
export function seats(o: Occupancy | undefined, steering: 'left' | 'right' = 'left'): Seat[] {
  if (!o || !o.available || o.belted_readings === 0) return []
  const driverColumn = steering === 'right' ? 1 : 0
  const share = (n: number) => pct(n, o.belted_readings)
  return [
    { id: 'driver', label: 'Driver', column: driverColumn, row: 0, pct: 100, readings: o.belted_readings },
    { id: 'passenger', label: 'Front passenger', column: driverColumn === 0 ? 1 : 0, row: 0, pct: share(o.passenger_readings), readings: o.passenger_readings },
    { id: 'rear_left', label: 'Rear left', column: 0, row: 1, pct: share(o.rear_left_readings ?? 0), readings: o.rear_left_readings ?? 0 },
    { id: 'rear_right', label: 'Rear right', column: 1, row: 1, pct: share(o.rear_right_readings ?? 0), readings: o.rear_right_readings ?? 0 },
  ]
}

/** How strongly a seat is shaded (0 to 1): its share, with a floor so an empty seat is still drawn. */
export const seatShade = (s: Pick<Seat, 'pct'>): number => 0.08 + 0.92 * ((s.pct ?? 0) / 100)

export const SEATS_NOTE = 'Each seat is shaded by how often its belt was buckled in the snapshots with the driver belted. A third row, a child seat and a passenger who does not buckle up are not seen.'
