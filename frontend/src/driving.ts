// Pure wording and maths of the "How the car is driven" panel (PLAN.md M48). No React in here.
// A STRETCH is the driving between two consecutive status reports: the data has no trips as such, and the
// page says so. Everything is described neutrally ("more short stretches"): it is about the car's use, never a
// verdict on the driver. All maths stays in the data's units; only what is shown is converted (units.ts).

import type { DrivingBand, DrivingMonth, DrivingPattern } from './api/types'
import { fmtNum } from './lib'
import { monthLabel } from './trends'
import { consumptionLabel, distanceText, fmtConsumption, getUnits } from './units'

/** The bands that count as "short": stretches under SHORT_KM. */
export const SHORT_BANDS = ['under_5', '5_to_20'] as const
export const SHORT_KM = 20
/** A month needs this many stretches in the bands before its mix is compared. */
export const MIN_STRETCHES = 10
/** What counts as a change worth a sentence: consumption in l/100 km, the short share in points. */
export const MIN_CHANGE = 0.2
export const MIN_SHIFT = 5

const plural = (n: number, word: string) => `${fmtNum(n)} ${word}${n === 1 ? '' : 'es'}`
const length = (km: number) => distanceText(km, getUnits().distance === 'km' ? 0 : 1)
const lengthNumber = (km: number) => length(km).split(' ')[0]

/** "under 5 km", "5 to 20 km", "over 100 km", in the reader's unit. */
export function bandLabel(b: Pick<DrivingBand, 'min_km' | 'max_km'>): string {
  if (b.max_km === null || b.max_km === undefined) return `over ${length(b.min_km)}`
  if (b.min_km === 0) return `under ${length(b.max_km)}`
  return `${lengthNumber(b.min_km)} to ${length(b.max_km)}`
}

/** A part of a whole in percent, or null when there is no whole. */
export const share = (part: number, whole: number): number | null => (whole > 0 ? (100 * part) / whole : null)
export const pct = (v: number | null): string => (v === null ? '—' : `${fmtNum(v)}%`)

const sum = (bands: readonly DrivingBand[], field: 'km' | 'stretches') => bands.reduce((s, b) => s + b[field], 0)
const isShort = (b: DrivingBand) => (SHORT_BANDS as readonly string[]).includes(b.band)

/** The share of the distance driven in stretches under SHORT_KM (of the stretches put in a band). */
export const shortShare = (bands: readonly DrivingBand[]): number | null =>
  share(sum(bands.filter(isShort), 'km'), sum(bands, 'km'))

/** The sentence above the table. */
export function headline(d: DrivingPattern | undefined): string | null {
  if (!d) return null
  if (d.stretches === 0) return 'No driving seen in this period.'
  const shortest = d.bands[0]
  const said = [`${plural(d.stretches, 'stretch')} of driving in this period.`]
  if (shortest && shortest.stretches > 0) {
    said.push(
      `${fmtNum(shortest.stretches)} of them (${pct(share(shortest.stretches, d.stretches))}) were ${bandLabel(shortest)}, ` +
        `${pct(share(shortest.km, d.km))} of the distance.`,
    )
  }
  return said.join(' ')
}

/** The stretches left out of the bands, or null when there is none. */
export function unclassifiedNote(d: DrivingPattern | undefined): string | null {
  if (!d || d.unclassified.stretches === 0) return null
  const n = d.unclassified.stretches
  return (
    `${plural(n, 'stretch')} (${distanceText(d.unclassified.km)}) ${n === 1 ? 'is' : 'are'} in no band: the two reports ` +
    `around ${n === 1 ? 'it' : 'each'} are ${fmtNum(d.gap_hours / 24)} days or more apart, so ${n === 1 ? 'it is' : 'they are'} probably several drives.`
  )
}

export interface MixChange {
  month: string
  previous: string
  /** l/100 km of each month (every stretch, as on the charts above) */
  now: number
  before: number
  /** share of the distance in short stretches, in percent */
  shortNow: number
  shortBefore: number
  /** what this month's mix would give with the previous month's consumption for each length; null when a
   * length driven this month has no consumption in the previous one */
  expected: number | null
}

const inBands = (m: DrivingMonth) => sum(m.bands, 'stretches')

/** This month's mix of lengths at the previous month's consumption of each length (weighted by distance). */
export function expectedFromMix(now: DrivingMonth, before: DrivingMonth): number | null {
  const km = sum(now.bands, 'km')
  if (km <= 0) return null
  let litres = 0
  for (const b of now.bands) {
    if (b.km === 0) continue
    const rate = before.bands.find((x) => x.band === b.band)?.l_per_100km
    if (rate === null || rate === undefined) return null
    litres += (b.km * rate) / 100
  }
  return (100 * litres) / km
}

/**
 * The months whose consumption and mix of lengths moved together against the month before: the consumption by
 * MIN_CHANGE or more, the short share by MIN_SHIFT points or more, in the same direction (more short stretches
 * with a higher consumption, or fewer with a lower one). Anything else is left unsaid.
 */
export function mixChanges(months: readonly DrivingMonth[]): MixChange[] {
  const found: MixChange[] = []
  for (let i = 1; i < months.length; i++) {
    const [before, now] = [months[i - 1], months[i]]
    if (now.l_per_100km == null || before.l_per_100km == null) continue
    if (inBands(now) < MIN_STRETCHES || inBands(before) < MIN_STRETCHES) continue
    const [shortNow, shortBefore] = [shortShare(now.bands), shortShare(before.bands)]
    if (shortNow === null || shortBefore === null) continue
    const change = now.l_per_100km - before.l_per_100km
    const shift = shortNow - shortBefore
    if (Math.abs(change) < MIN_CHANGE || Math.abs(shift) < MIN_SHIFT || Math.sign(change) !== Math.sign(shift)) continue
    found.push({
      month: now.month, previous: before.month, now: now.l_per_100km, before: before.l_per_100km, shortNow, shortBefore,
      expected: expectedFromMix(now, before),
    })
  }
  return found
}

/** One change in words: the two figures side by side, and how much of it the mix alone accounts for. */
export function describeMix(c: MixChange): string {
  const unit = consumptionLabel()
  const [month, previous] = [monthLabel(c.month), monthLabel(c.previous)]
  const said = [
    `${month}: ${fmtConsumption(c.now, 1)} ${unit}, ${previous}: ${fmtConsumption(c.before, 1)}. ` +
      `Stretches under ${length(SHORT_KM)} went from ${pct(c.shortBefore)} to ${pct(c.shortNow)} of the distance.`,
  ]
  if (c.expected !== null) {
    said.push(
      `With ${previous}'s consumption for each length, ${month}'s mix alone would give ${fmtConsumption(c.expected, 1)}.`,
    )
  }
  return said.join(' ')
}

export const drivingNotes = (minKm: number): string[] => [
  'A stretch is the driving between two status reports in a row: the car does not report single trips, so one stretch can be part of a trip or several short ones.',
  `A consumption is shown from ${distanceText(minKm)} on. The car rounds the average it reports, so the shortest stretches give the least exact figures.`,
  'Two months side by side show what moved together, not what caused what.',
]
