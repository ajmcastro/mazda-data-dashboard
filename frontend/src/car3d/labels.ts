// Where the labels go (PLAN.md M39). Pure: screen points in, label boxes out, so it is tested without a canvas.
// Each label sits in a column at the left or right edge of the view, at the height of its part where it can,
// pushed apart where two would overlap. A label keeps its side while its part stays near the middle, so
// labels do not jump from side to side as the car turns.

import type { CarState, Part, PartId } from '../car'

export interface Point {
  id: PartId
  /** Where the part is on screen (pixels from the top left of the view). */
  x: number
  y: number
  /** False when the part is turned away from the camera. */
  facing: boolean
}

export type Side = 'left' | 'right'

export interface Placed {
  id: PartId
  side: Side
  /** Top left corner of the label box. */
  left: number
  top: number
  /** The end of the leader line at the label, and at the part. */
  from: { x: number; y: number }
  to: { x: number; y: number }
  facing: boolean
}

export interface LabelBox {
  width: number
  height: number
  /** Space between labels, and between a label and the edge of the view. */
  gap: number
}

export const LABEL: LabelBox = { width: 132, height: 38, gap: 6 }

/** A part within this share of the width around the middle keeps the side it had. */
const KEEP = 0.12

function spread(tops: number[], height: number, gap: number, min: number, max: number): number[] {
  const out = [...tops]
  for (let i = 0; i < out.length; i++) {
    const floor = i === 0 ? min : out[i - 1] + height + gap
    if (out[i] < floor) out[i] = floor
  }
  // too far down: push back up from the bottom
  for (let i = out.length - 1; i >= 0; i--) {
    const ceil = i === out.length - 1 ? max - height : out[i + 1] - height - gap
    if (out[i] > ceil) out[i] = ceil
  }
  return out
}

export function layoutLabels(
  points: readonly Point[],
  view: { width: number; height: number },
  previous: ReadonlyMap<PartId, Side> = new Map(),
  box: LabelBox = LABEL,
): Placed[] {
  const mid = view.width / 2
  const sided = points.map((p) => {
    const kept = previous.get(p.id)
    const side: Side = kept && Math.abs(p.x - mid) < KEEP * view.width ? kept : p.x < mid ? 'left' : 'right'
    return { p, side }
  })
  const placed: Placed[] = []
  for (const side of ['left', 'right'] as const) {
    // by height on screen; the id breaks ties so the order never depends on the input order
    const column = sided.filter((s) => s.side === side).sort((a, b) => a.p.y - b.p.y || a.p.id.localeCompare(b.p.id))
    const tops = spread(column.map((s) => s.p.y - box.height / 2), box.height, box.gap, box.gap, view.height - box.gap)
    const left = side === 'left' ? box.gap : view.width - box.gap - box.width
    column.forEach(({ p }, i) => {
      placed.push({
        id: p.id, side, left, top: tops[i], facing: p.facing,
        from: { x: side === 'left' ? left + box.width : left, y: tops[i] + box.height / 2 },
        to: { x: p.x, y: p.y },
      })
    })
  }
  return placed
}

/**
 * The parts that get a label. Wheels, fuel, engine and dashboard always (when the car sends them); a door, the
 * trunk or the hood only when it is not simply closed, or when it is the selected part: six "closed" labels
 * would bury the figures.
 */
export function labelledParts(car: CarState, selected: PartId | null): Part[] {
  const always = car.parts.filter((p) => p.state !== 'absent' && (p.group !== 'doors' || p.state !== 'ok'))
  // a closed door that was clicked comes last, so the numbers of the pins already on screen do not change
  const extra = car.parts.filter((p) => p.id === selected && p.state !== 'absent' && !always.includes(p))
  return [...always, ...extra]
}

/** The two lines of a label: a short name ("Front left" for "Front left wheel") and the figure. */
export function labelText(p: Part): { name: string; value: string } {
  if (p.group === 'wheels') return { name: p.name.replace(/ wheel$/, ''), value: p.value }
  // "6,000 km to oil change" does not fit: the name says what the figure is
  const oil = p.id === 'engine' ? /^(.*) to oil change$/.exec(p.value) : null
  if (oil) return { name: 'Oil change in', value: oil[1] }
  const flag = p.id === 'engine' ? /^oil level flag (on|clear)$/.exec(p.value) : null
  return flag ? { name: 'Oil level flag', value: flag[1] } : { name: p.name, value: p.value }
}

/** How many labels fit in one column of a view this high. */
export function columnCapacity(height: number, box: LabelBox = LABEL): number {
  return Math.max(0, Math.floor((height - box.gap) / (box.height + box.gap)))
}

// ---- narrow screens: numbered pins on the car, the figures in a numbered list under it (M40) ----

export interface Pin {
  id: PartId
  /** The number shown on the pin and in the list (1 = the first labelled part, in the car's fixed order). */
  n: number
  /** Centre of the pin. */
  x: number
  y: number
  facing: boolean
}

/** Radius of a pin, and the view width under which pins replace the labels (two label columns leave no room for the car). */
export const PIN_RADIUS = 11
export const COMPACT_WIDTH = 560

/**
 * Pins at their parts, numbered in the order given, moved apart where two would cover each other (the engine and
 * the hood are close from most angles) and kept inside the view. The same input always gives the same pins.
 */
export function layoutPins(points: readonly Point[], view: { width: number; height: number }, radius = PIN_RADIUS): Pin[] {
  const pins = points.map((p, i) => ({ id: p.id, n: i + 1, x: p.x, y: p.y, facing: p.facing }))
  const min = 2 * radius + 2
  const clamp = (pin: Pin) => {
    pin.x = Math.min(view.width - radius, Math.max(radius, pin.x))
    pin.y = Math.min(view.height - radius, Math.max(radius, pin.y))
  }
  pins.forEach(clamp)
  for (let pass = 0; pass < 12; pass++) {
    let moved = false
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i]
        const b = pins[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= min) continue
        if (d < 0.01) {
          // exactly on top of each other: part them sideways, the lower number to the left
          dx = 1
          dy = 0
          d = 1
        }
        const push = (min - d) / 2
        a.x -= (dx / d) * push
        a.y -= (dy / d) * push
        b.x += (dx / d) * push
        b.y += (dy / d) * push
        clamp(a)
        clamp(b)
        moved = true
      }
    }
    if (!moved) break
  }
  return pins
}
