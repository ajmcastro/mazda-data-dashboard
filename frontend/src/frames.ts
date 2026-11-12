// Pure wording of the "In the freeze frames" summary of a fault (PLAN.md M36). No React in here.
// It is a hint ("tends to appear when ..."), never a cause: the frames are few and several faults can share
// the same frame, so every figure comes with its number of frames.

import type { FaultFrameSummary, FrameSignalSummary } from './api/types'
import { fmtNum } from './lib'

/** A fault with fewer frames than this gets a caution: a range from one or two frames is thin. */
export const FEW_FRAMES = 5

const num = (v: number | null | undefined) => fmtNum(v, Number.isInteger(v) ? 0 : 1)

/** "12.6–13.1 V (median 12.9)", or "12.5 V" when every frame has the same value. */
export function rangeText(min: number | null, median: number | null, max: number | null, unit: string | null): string {
  if (min === null || max === null) return '—'
  const u = unit ? ` ${unit}` : ''
  if (min === max) return `${num(min)}${u}`
  return `${num(min)}–${num(max)}${u} (median ${num(median)})`
}

export const faultRange = (s: FrameSignalSummary) => rangeText(s.min ?? null, s.median ?? null, s.max ?? null, s.unit ?? null)
export const baselineRange = (s: FrameSignalSummary) =>
  rangeText(s.baseline_min ?? null, s.baseline_median ?? null, s.baseline_max ?? null, s.unit ?? null)

export const POSITION_TEXT = {
  low: 'among the lowest tenth of other faults’ frames',
  high: 'among the highest tenth of other faults’ frames',
} as const

// "Battery charge" -> "battery charge", but an acronym stays: "ECU power voltage"
const lower = (label: string) =>
  /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1)

/** "Tends to appear when battery charge is low and coolant temperature is high." or null when nothing stands out. */
export function hintLine(s: FaultFrameSummary): string | null {
  const items = s.signals.filter((x) => x.position).map((x) => `${lower(x.label)} is ${x.position}`)
  if (items.length === 0) return null
  const joined = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
  return `Tends to appear when ${joined}.`
}

/** The caution under the table: few frames, or frames shared by several faults. */
export function cautionNote(s: Pick<FaultFrameSummary, 'frames' | 'baseline_frames'>): string {
  const few =
    s.frames < FEW_FRAMES
      ? `Only ${s.frames} frame${s.frames === 1 ? '' : 's'} for this fault: read the ranges as a hint, not a pattern. `
      : ''
  return (
    `${few}Compared with ${s.baseline_frames} frames of the car’s other faults. ` +
    'Faults recorded at the same moment share one frame and count separately. This describes the car when a fault was ' +
    'recorded, not what caused it.'
  )
}
