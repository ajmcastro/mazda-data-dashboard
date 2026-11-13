// What every shape of the schematic car is made of (PLAN.md M39, M42). Pure numbers: no three.js here, so the
// proportions, the hinges and the points the labels hang on are unit tested, and `scene.ts` only turns them
// into meshes. A shape (`generic.ts`, `cx60.ts`) builds a `CarGeometry` from a `Body`.
//
// Axes (metres): x along the car with the FRONT at +x, y up with the ground at 0, z across with the car's RIGHT
// side at +z (so the left side is -z). The origin is under the middle of the car's length.

import type { PartId } from '../../car'

export interface Body {
  length: number
  width: number
  height: number
  wheelbase: number
  /** Distance between the left and right wheel centres. */
  track: number
  wheelDiameter: number
  /** Which side the driver sits on: the data says "driver door", not "left door". */
  steering: 'left' | 'right'
  /** Which outline is drawn: the generic SUV, or a model's own (`body.shape` in its model.yaml). */
  shape: ShapeName
}

/** The shapes that exist. Keep equal to `SHAPES` in backend/src/mazda_dash/models.py (a test compares them). */
export const SHAPES = ['generic', 'cx60'] as const
export type ShapeName = (typeof SHAPES)[number]

/** A mid-size SUV, used until a model brings its own dimensions (M41). */
export const DEFAULT_BODY: Body = {
  length: 4.6, width: 1.85, height: 1.68, wheelbase: 2.7, track: 1.6, wheelDiameter: 0.72, steering: 'left', shape: 'generic',
}

export type Vec3 = readonly [number, number, number]
export type Vec2 = readonly [number, number]

export interface Wheel {
  id: PartId
  centre: Vec3
  radius: number
  width: number
  /** +1 for the right side, -1 for the left. */
  side: 1 | -1
}

/** A side door: a flat panel that turns outward about a vertical hinge at its front edge. */
export interface Door {
  id: PartId
  side: 1 | -1
  /** Front (hinge) and rear x of the panel, bottom and top y. */
  x0: number
  x1: number
  y0: number
  y1: number
  /** z of the panel's outer face. */
  z: number
  /** The panel's outline in the side view (x, y); the box above is its bounding box. */
  outline: Vec2[]
}

export interface Anchor {
  /** The point the label's line ends at. */
  pos: Vec3
  /** Outward direction of a part on the surface; null for a point that is never "on the far side". */
  normal: Vec3 | null
}

export interface CarGeometry {
  body: Body
  /** Side outline of the lower body (x, y), closed, with the two wheel arches cut out. */
  lower: Vec2[]
  /** Side outline of the cabin (the glass house), closed. */
  cabin: Vec2[]
  /** Width of the cabin (narrower than the body). */
  cabinWidth: number
  wheels: Wheel[]
  doors: Door[]
  /** The hood: hinged at the rear (`hinge`), reaching forward to `tip`, both in the side view; `line` is its
   *  surface from hinge to tip (two points for a flat hood). */
  hood: { hinge: Vec2; tip: Vec2; width: number; line: Vec2[] }
  /** The tailgate: hinged at the roof, down the rear window to `knee` and on to `foot`, in the side view;
   *  `line` is its surface from hinge to foot. */
  trunk: { hinge: Vec2; knee: Vec2; foot: Vec2; width: number; line: Vec2[] }
  anchors: Record<PartId, Anchor>
  /** How the body is shaped across its width, and its details (M43). Absent: a plain slab, as the generic car. */
  style?: Style
  /** What the camera looks at, and the radius of a sphere that holds the whole car. */
  centre: Vec3
  radius: number
}

/** A small block on the car: a lamp, the grille, a mirror. `tone` is a neutral colour, never a state colour. */
export interface Detail {
  name: string
  centre: Vec3
  size: Vec3
  tone: 'trim' | 'lamp' | 'panel'
}

/**
 * The shape of a car seen from above and from the front, and what is drawn on it. All lengths in metres,
 * widths as a share of half the body width.
 */
export interface Style {
  /** The body narrows from `noseFrom` (x) to the nose, where its half-width is `noseWidth` and its corners sit
   *  `noseRound` behind its middle; the same at the tail (from `tailFrom` rearwards). */
  noseFrom: number
  noseWidth: number
  noseRound: number
  tailFrom: number
  tailWidth: number
  tailRound: number
  /** The cabin leans in: its half-width at the height where the glass starts (`beltY`) and at the roof. */
  beltY: number
  cabinBelt: number
  cabinRoof: number
  /** How far the long edges of the body are rounded off. */
  fillet: number
  /** The roof as a band in the side view (closed outline), drawn solid on top of the glass. */
  roof: Vec2[]
  /** The pillars: closed outlines in the side view, drawn solid on both sides of the glass. */
  pillars: Vec2[][]
  details: Detail[]
  /** Spokes per wheel. */
  spokes: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** 0 at `from`, 1 at `to`, eased so the taper starts gently. */
const ramp = (from: number, to: number, x: number) => {
  const t = clamp01((x - from) / (to - from))
  return t * t
}

/** The body's half-width at x (metres): full between the axles, narrower towards the nose and the tail. */
export function halfWidthAt(g: Pick<CarGeometry, 'body' | 'style'>, x: number): number {
  const half = g.body.width / 2
  const s = g.style
  if (!s) return half
  const nose = ramp(s.noseFrom, g.body.length / 2, x)
  const tail = ramp(s.tailFrom, -g.body.length / 2, x)
  return half * (1 - nose * (1 - s.noseWidth) - tail * (1 - s.tailWidth))
}

/** The cabin's half-width at (x, y): the body's, leaning in from the belt line up to the roof. */
export function cabinHalfWidthAt(g: Pick<CarGeometry, 'body' | 'style'>, x: number, y: number): number {
  const s = g.style
  if (!s) return halfWidthAt(g, x)
  const up = clamp01((y - s.beltY) / (g.body.height - s.beltY))
  return halfWidthAt(g, x) * (s.cabinBelt + (s.cabinRoof - s.cabinBelt) * up)
}

/**
 * How far a point at the edge of the body (z = the half-width) sits towards the middle of the car's length,
 * compared with the point on the centre line: the rounding of the nose and tail seen from above. Positive
 * moves rearwards (at the nose), negative forwards (at the tail).
 */
export function planShiftAt(g: Pick<CarGeometry, 'body' | 'style'>, x: number): number {
  const s = g.style
  if (!s) return 0
  return ramp(s.noseFrom, g.body.length / 2, x) * s.noseRound - ramp(s.tailFrom, -g.body.length / 2, x) * s.tailRound
}

/** The height of a line of points (side view) at x, by straight lines between them; the nearest end outside. */
export function heightOnLine(line: readonly Vec2[], x: number): number {
  const pts = [...line].sort((a, b) => a[0] - b[0])
  if (x <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return pts[pts.length - 1][1]
}

export const ARCH_STEPS = 10
/** How much wider than the tire the wheel arch is cut. */
export const ARCH_GAP = 0.07
export const TIRE_WIDTH = 0.235
export const PANEL = 0.012 // how far a door stands out from the body side

export const round = (v: number) => Math.round(v * 1000) / 1000
export const v2 = (x: number, y: number): Vec2 => [round(x), round(y)]
export const v3 = (x: number, y: number, z: number): Vec3 => [round(x), round(y), round(z)]

/** Clamps a body to something drawable (a typo in a model's file must not turn the car inside out). */
export function saneBody(b: Partial<Body> | undefined): Body {
  const d = DEFAULT_BODY
  const pick = (v: number | undefined, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback
  const length = pick(b?.length, 3.6, 6, d.length)
  const width = pick(b?.width, 1.4, 2.3, d.width)
  // a dimension that is not given is the default one where that fits this car, else in proportion to it
  const fits = (v: number, lo: number, hi: number, fallback: number) => (v >= lo && v <= hi ? v : fallback)
  return {
    length,
    width,
    height: pick(b?.height, 1.2, 2.2, d.height),
    // two arches and two doors must fit between the axles, and both overhangs must hold a wheel
    wheelbase: pick(b?.wheelbase, 0.5 * length, 0.68 * length, fits(d.wheelbase, 0.5 * length, 0.68 * length, 0.59 * length)),
    track: pick(b?.track, 1.2, width - TIRE_WIDTH, fits(d.track, 1.2, width - TIRE_WIDTH, width - 0.25)),
    wheelDiameter: pick(b?.wheelDiameter, 0.5, 0.9, d.wheelDiameter),
    steering: b?.steering === 'right' ? 'right' : 'left',
    shape: SHAPES.includes(b?.shape as ShapeName) ? (b?.shape as ShapeName) : 'generic',
  }
}


/** A model's dimensions as the API gives them (`body` of GET /api/models): millimetres, any of them missing. */
export interface ModelBody {
  length_mm?: number | null
  width_mm?: number | null
  height_mm?: number | null
  wheelbase_mm?: number | null
  track_mm?: number | null
  wheel_diameter_mm?: number | null
  steering?: 'left' | 'right'
  /** The name of the model's outline; an unknown one is drawn as the generic car. */
  shape?: string | null
}

/** The model's dimensions in metres, leaving out what it does not give (`saneBody` fills those in). */
export function bodyOfModel(b: ModelBody | null | undefined): Partial<Body> | undefined {
  if (!b) return undefined
  const m = (v: number | null | undefined) => (typeof v === 'number' ? v / 1000 : undefined)
  const out: Partial<Body> = {
    length: m(b.length_mm), width: m(b.width_mm), height: m(b.height_mm), wheelbase: m(b.wheelbase_mm),
    track: m(b.track_mm), wheelDiameter: m(b.wheel_diameter_mm), steering: b.steering,
    shape: SHAPES.includes(b.shape as ShapeName) ? (b.shape as ShapeName) : undefined,
  }
  for (const key of Object.keys(out) as (keyof Body)[]) if (out[key] === undefined) delete out[key]
  return out
}

/** The points of a wheel arch cut into the sill line, from its rear end over the top to its front end. */
export function archPoints(cx: number, r: number, archR: number, sill: number): Vec2[] {
  const dx = Math.sqrt(archR * archR - (r - sill) * (r - sill))
  const a0 = Math.atan2(sill - r, -dx) // where the arch leaves the sill, rear side
  const a1 = Math.atan2(sill - r, dx)
  const from = a0 < 0 ? a0 + 2 * Math.PI : a0 // just past pi
  const pts: Vec2[] = []
  for (let i = 0; i <= ARCH_STEPS; i++) {
    const a = from + ((a1 - from) * i) / ARCH_STEPS
    pts.push(v2(cx + archR * Math.cos(a), r + archR * Math.sin(a)))
  }
  return pts
}

export function makeWheels(body: Body, frontAxle: number, rearAxle: number): Wheel[] {
  const r = body.wheelDiameter / 2
  const wheel = (id: PartId, x: number, side: 1 | -1): Wheel => ({
    id, side, radius: round(r), width: TIRE_WIDTH, centre: v3(x, r, side * (body.track / 2)),
  })
  return [wheel('wheel_fl', frontAxle, -1), wheel('wheel_fr', frontAxle, 1), wheel('wheel_rl', rearAxle, -1), wheel('wheel_rr', rearAxle, 1)]
}

/** The outer face of a wheel, and of a door (the middle of its bounding box). */
export const wheelAnchor = (w: Wheel, track: number): Anchor => ({
  pos: v3(w.centre[0], w.centre[1], w.side * (track / 2 + TIRE_WIDTH / 2)), normal: [0, 0, w.side],
})
export const doorAnchor = (d: Door, width: number): Anchor => ({
  pos: v3((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, d.side * (width / 2 + PANEL)), normal: [0, 0, d.side],
})
