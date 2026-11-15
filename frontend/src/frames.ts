// Pure wording of the "In the freeze frames" summary of a fault (PLAN.md M36). No React in here.
// It is a hint ("tends to appear when ..."), never a cause: the frames are few and several faults can share
// the same frame, so every figure comes with its number of frames.

import { carState, type CarState } from './car'
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

// ------------------------------------------------------------ the fault on the car (M58)

/** Which part of the car each freeze-frame signal is shown on. The battery has no part of its own: it is
 *  drawn where the hood is and LABELLED "Battery" (the drawing does not say where a battery sits). */
export const FRAME_PART: Record<string, 'hood' | 'engine' | 'dash'> = {
  Main_ECU_Voltage_Supply: 'hood',
  ECU_Power_Voltage: 'hood',
  SOC_StateOfCharge: 'hood',
  Engine_Coolant_Temperature: 'engine',
  Vehicle_Speed: 'dash',
}
const FRAME_PART_NAME = { hood: 'Battery', engine: 'Engine', dash: 'Dashboard' } as const

/**
 * A fault's freeze frames as a car to draw: three parts carry what the frames recorded (the fault's range as the
 * figure, the other faults' frames as a note), every other part is absent. A part is marked ONLY where the
 * summary marks a position (among the lowest or highest tenth of the other faults' frames); nothing is marked
 * for a signal without one, however odd its value looks.
 */
export function frameCar(s: FaultFrameSummary | undefined): CarState {
  const parts = carState(undefined, undefined, undefined, undefined).parts.map((p) => ({ ...p, state: 'absent' as const, notes: [] as string[] }))
  if (!s) return { parts, hasData: false, asOf: null }
  const out = parts.map((p) => {
    if (p.id !== 'hood' && p.id !== 'engine' && p.id !== 'dash') return p
    const signals = s.signals.filter((x) => FRAME_PART[x.signal] === p.id && x.min !== null && x.min !== undefined)
    if (signals.length === 0) return p
    const marked = signals.some((x) => x.position)
    return {
      ...p,
      name: FRAME_PART_NAME[p.id],
      group: 'other' as const,
      state: marked ? ('attention' as const) : ('ok' as const),
      value: faultRange(signals[0]),
      notes: signals.flatMap((x) => [
        `${x.label}: ${faultRange(x)} in this fault's frames; ${baselineRange(x)} in the other faults' frames`,
        ...(x.position ? [`${lower(x.label)}: ${POSITION_TEXT[x.position]}`] : []),
      ]),
      at: null,
      old: false,
    }
  })
  return { parts: out, hasData: out.some((p) => p.state !== 'absent'), asOf: null }
}
