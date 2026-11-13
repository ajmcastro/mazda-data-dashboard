// The shape of the schematic car, from a handful of dimensions (PLAN.md M39). Pure numbers: no three.js here,
// so the proportions, the hinges and the points the labels hang on are unit tested, and `scene.ts` only turns
// them into meshes. It is a generic SUV outline, not any model's styling.
//
// Axes (metres): x along the car with the FRONT at +x, y up with the ground at 0, z across with the car's RIGHT
// side at +z (so the left side is -z). The origin is under the middle of the car's length.

import type { PartId } from '../car'

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
}

/** A mid-size SUV, used until a model brings its own dimensions (M41). */
export const DEFAULT_BODY: Body = {
  length: 4.6, width: 1.85, height: 1.68, wheelbase: 2.7, track: 1.6, wheelDiameter: 0.72, steering: 'left',
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
}

/** The model's dimensions in metres, leaving out what it does not give (`saneBody` fills those in). */
export function bodyOfModel(b: ModelBody | null | undefined): Partial<Body> | undefined {
  if (!b) return undefined
  const m = (v: number | null | undefined) => (typeof v === 'number' ? v / 1000 : undefined)
  const out: Partial<Body> = {
    length: m(b.length_mm), width: m(b.width_mm), height: m(b.height_mm), wheelbase: m(b.wheelbase_mm),
    track: m(b.track_mm), wheelDiameter: m(b.wheel_diameter_mm), steering: b.steering,
  }
  for (const key of Object.keys(out) as (keyof Body)[]) if (out[key] === undefined) delete out[key]
  return out
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
  /** The hood: hinged at the rear (`hinge`), reaching forward to `tip`, both in the side view. */
  hood: { hinge: Vec2; tip: Vec2; width: number }
  /** The tailgate: hinged at the roof, down the rear window to `knee` and on to `foot`, in the side view. */
  trunk: { hinge: Vec2; knee: Vec2; foot: Vec2; width: number }
  anchors: Record<PartId, Anchor>
  /** What the camera looks at, and the radius of a sphere that holds the whole car. */
  centre: Vec3
  radius: number
}

const ARCH_STEPS = 10
/** How much wider than the tire the wheel arch is cut. */
const ARCH_GAP = 0.07
const TIRE_WIDTH = 0.235
const PANEL = 0.012 // how far a door stands out from the body side

const round = (v: number) => Math.round(v * 1000) / 1000
const v2 = (x: number, y: number): Vec2 => [round(x), round(y)]
const v3 = (x: number, y: number, z: number): Vec3 => [round(x), round(y), round(z)]

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
  }
}

export function carGeometry(input?: Partial<Body>): CarGeometry {
  const body = saneBody(input)
  const { length: L, width: W, height: H, wheelbase, track } = body
  const r = body.wheelDiameter / 2
  const xF = L / 2
  const xR = -L / 2
  // a little more overhang behind than in front, as on most SUVs
  const frontAxle = xF - (L - wheelbase) * 0.47
  const rearAxle = frontAxle - wheelbase
  const sill = 0.3 * r + 0.1 // underside of the body
  const belt = 0.57 * H // where the glass starts
  const nose = 0.49 * H // top of the front end
  const cowl = v2(frontAxle - 0.42, belt) // base of the windshield
  const roofFront = v2(cowl[0] - 0.3 * H, H)
  const roofRear = v2(xR + 0.2 * H, H - 0.04) // an SUV's tail is close to upright
  const deck = v2(xR + 0.07, belt + 0.02) // base of the rear window

  // ---- lower body outline, counter-clockwise from the rear bottom corner ----
  const archR = r + ARCH_GAP
  const dx = Math.sqrt(archR * archR - (r - sill) * (r - sill))
  const arch = (cx: number): Vec2[] => {
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
  const lower: Vec2[] = [
    v2(xR + 0.06, sill + 0.06),
    ...arch(rearAxle),
    ...arch(frontAxle),
    v2(xF - 0.1, sill + 0.04),
    v2(xF, sill + 0.22),
    v2(xF - 0.03, nose - 0.06),
    v2(xF - 0.12, nose),
    cowl,
    deck,
    v2(xR, belt - 0.16),
    v2(xR, sill + 0.28),
  ]
  const cabin: Vec2[] = [cowl, roofFront, roofRear, deck]
  const cabinWidth = round(0.86 * W)

  // ---- wheels ----
  const wheelZ = track / 2
  const wheel = (id: PartId, x: number, side: 1 | -1): Wheel => ({
    id, side, radius: round(r), width: TIRE_WIDTH, centre: v3(x, r, side * wheelZ),
  })
  const wheels = [
    wheel('wheel_fl', frontAxle, -1), wheel('wheel_fr', frontAxle, 1),
    wheel('wheel_rl', rearAxle, -1), wheel('wheel_rr', rearAxle, 1),
  ]

  // ---- side doors: two per side between the arches ----
  const doorFront = frontAxle - archR - 0.1
  const doorRear = rearAxle + archR + 0.05
  const pillar = doorFront - (doorFront - doorRear) * 0.52 // the front door is a little longer
  const driver: 1 | -1 = body.steering === 'left' ? -1 : 1
  const door = (id: PartId, side: 1 | -1, x0: number, x1: number): Door => ({
    id, side, x0: round(x0), x1: round(x1), y0: round(sill + 0.07), y1: round(belt - 0.03), z: round(side * (W / 2 + PANEL)),
  })
  const doors = [
    door('door_driver', driver, doorFront, pillar + 0.02),
    door('door_passenger', -driver as 1 | -1, doorFront, pillar + 0.02),
    door('door_rear_left', -1, pillar - 0.02, doorRear),
    door('door_rear_right', 1, pillar - 0.02, doorRear),
  ]

  const hood = { hinge: v2(cowl[0] + 0.04, cowl[1] + 0.012), tip: v2(xF - 0.14, nose + 0.012), width: round(0.86 * W) }
  const trunk = { hinge: v2(roofRear[0] - 0.02, roofRear[1]), knee: deck, foot: v2(xR, sill + 0.34), width: round(0.84 * W) }

  // ---- where the labels point ----
  const outer = W / 2 + PANEL
  const wheelAnchor = (w: Wheel): Anchor => ({
    pos: v3(w.centre[0], w.centre[1], w.side * (wheelZ + TIRE_WIDTH / 2)), normal: [0, 0, w.side],
  })
  const doorAnchor = (d: Door): Anchor => ({
    pos: v3((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, d.side * outer), normal: [0, 0, d.side],
  })
  const byId = <T extends { id: PartId }>(list: T[], id: PartId) => list.find((p) => p.id === id)!
  const anchors: Record<PartId, Anchor> = {
    wheel_fl: wheelAnchor(byId(wheels, 'wheel_fl')),
    wheel_fr: wheelAnchor(byId(wheels, 'wheel_fr')),
    wheel_rl: wheelAnchor(byId(wheels, 'wheel_rl')),
    wheel_rr: wheelAnchor(byId(wheels, 'wheel_rr')),
    door_driver: doorAnchor(byId(doors, 'door_driver')),
    door_passenger: doorAnchor(byId(doors, 'door_passenger')),
    door_rear_left: doorAnchor(byId(doors, 'door_rear_left')),
    door_rear_right: doorAnchor(byId(doors, 'door_rear_right')),
    trunk: { pos: v3(xR, (trunk.knee[1] + trunk.foot[1]) / 2, 0), normal: [-1, 0, 0] },
    hood: { pos: v3((hood.hinge[0] + hood.tip[0]) / 2, (hood.hinge[1] + hood.tip[1]) / 2 + 0.02, 0), normal: null },
    // the tank sits under the rear seat, the engine between the front wheels, the dashboard behind the windshield
    // on the driver's side: points inside the car, so they are never "on the far side"
    fuel: { pos: v3(rearAxle + 0.45, sill + 0.12, 0), normal: null },
    engine: { pos: v3(frontAxle + 0.05, (sill + nose) / 2, 0), normal: null },
    dash: { pos: v3(cowl[0] - 0.3, belt + 0.03, driver * 0.2 * W), normal: null },
  }

  return {
    body, lower, cabin, cabinWidth, wheels, doors, hood, trunk, anchors,
    centre: v3(0, H * 0.42, 0),
    radius: round(Math.hypot(L / 2, H / 2, W / 2)),
  }
}

/** True when a part on the surface is turned towards the camera (a point without a normal always is). */
export function facesCamera(anchor: Anchor, camera: Vec3): boolean {
  if (!anchor.normal) return true
  const [nx, ny, nz] = anchor.normal
  const [px, py, pz] = anchor.pos
  return nx * (camera[0] - px) + ny * (camera[1] - py) + nz * (camera[2] - pz) > 0
}

/** How far a part swings when it is open (radians). */
export const OPEN_ANGLE = { door: 0.62, hood: 0.5, trunk: 1.0 } as const
