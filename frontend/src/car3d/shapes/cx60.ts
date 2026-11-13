// The Mazda CX-60's own outline (PLAN.md M42): a likeness traced by hand from the owner's photo of the car's
// left side, not a measured drawing and not a Mazda model file. The photo was taken close with a wide lens, so
// nothing here is a measurement: every point is a FRACTION, placed on the car by the model's published
// dimensions (length, height, wheelbase, wheel size from `body:` in its model.yaml).
//
// A point is [p, h]:
//   p  along the car, by the axles: -1 = the nose, 0 = the front axle, 1 = the rear axle, 2 = the tail;
//   h  height as a share of the car's height (0 = the ground, 1 = the roof's highest point).
// What it shows that the generic shape does not: the long hood, the cabin set far back (the windshield starts
// a fifth of the wheelbase behind the front axle), the roof highest over the front seats and falling to a
// raked tail, the short rear overhang, and the rear door's edge running over the rear wheel arch.

import type { PartId } from '../../car'
import {
  ARCH_GAP, PANEL, archPoints, doorAnchor, makeWheels, round, v2, v3, wheelAnchor,
  type Anchor, type Body, type CarGeometry, type Door, type Vec2,
} from './common'

type Frac = readonly [number, number]

/** The front overhang's share of what is left of the length after the wheelbase (it is the shorter one). */
const FRONT_SHARE = 0.42
/** Underside of the body. */
const SILL = 0.133

/** From the bottom of the front bumper up the nose and back along the hood to the base of the windshield. */
const NOSE: Frac[] = [
  [-0.89, SILL], [-0.988, 0.194], [-1, 0.365], [-0.97, 0.467], [-0.89, 0.551], [-0.598, 0.596], [0.003, 0.656],
  [0.137, 0.69], [0.205, 0.7],
]
/** How many of the last points of NOSE are the hood (from its leading edge to the windshield). */
const HOOD_POINTS = 5

/** The glass house: up the windshield, along the roof to the spoiler, down the rear window. */
const CABIN: Frac[] = [
  [0.205, 0.7], [0.303, 0.836], [0.404, 0.905], [0.48, 0.952], [0.567, 0.99], [0.675, 1], [0.81, 0.988],
  [0.945, 0.957], [1.258, 0.918], [1.52, 0.899], [1.677, 0.807], [1.834, 0.716],
]

/** From the base of the rear window down the tail (the tail lights are the rearmost point) to the bumper. */
const TAIL: Frac[] = [
  [1.834, 0.716], [1.913, 0.651], [2, 0.615], [1.934, 0.517], [1.913, 0.421], [1.873, 0.26], [1.803, 0.217],
]

/** Where the tailgate is hinged on the roof, and which point of TAIL it reaches down to. */
const TAILGATE_HINGE: Frac = [1.45, 0.905]
const TAILGATE_FOOT = 4

/** The doors, front edge first. The pillar between them leans back, the rear door ends over the wheel arch. */
const DOOR_GAP = 0.006
const FRONT_DOOR: Frac[] = [[0.239, 0.705], [0.251, SILL], [0.605 - DOOR_GAP, SILL], [0.646 - DOOR_GAP, 0.682]]
const REAR_DOOR: Frac[] = [
  [0.646 + DOOR_GAP, 0.682], [0.605 + DOOR_GAP, SILL], [0.832, SILL], [0.857, 0.311], [0.911, 0.389], [0.978, 0.459],
  [1.052, 0.512], [1.083, 0.626], [0.997, 0.684],
]

export function cx60Geometry(body: Body): CarGeometry {
  const { length: L, width: W, height: H, wheelbase, track } = body
  const r = body.wheelDiameter / 2
  const xF = L / 2
  const xR = -L / 2
  const frontAxle = xF - (L - wheelbase) * FRONT_SHARE
  const rearAxle = frontAxle - wheelbase
  /** p (see the top of the file) to metres along the car. */
  const X = (p: number) =>
    p < 0 ? frontAxle - p * (xF - frontAxle) : p <= 1 ? frontAxle - p * wheelbase : rearAxle - (p - 1) * (rearAxle - xR)
  const pt = ([p, h]: Frac): Vec2 => v2(X(p), h * H)
  const sill = SILL * H
  const archR = r + ARCH_GAP

  // ---- outlines: the lower body counter-clockwise from the rear bumper's bottom, with the two arches cut in ----
  const lower: Vec2[] = [
    pt(TAIL[TAIL.length - 1]),
    ...archPoints(rearAxle, r, archR, sill),
    ...archPoints(frontAxle, r, archR, sill),
    ...NOSE.map(pt),
    ...TAIL.slice(0, -1).map(pt),
  ]
  const cabin = CABIN.map(pt)
  const cowl = pt(NOSE[NOSE.length - 1])
  const deck = pt(TAIL[0])
  /** Height of the line where the glass starts, at x. */
  const belt = (x: number) => cowl[1] + ((deck[1] - cowl[1]) * (x - cowl[0])) / (deck[0] - cowl[0])

  const wheels = makeWheels(body, frontAxle, rearAxle)

  // ---- doors: the traced outlines, kept under the glass, above the sill and clear of the wheel arches ----
  const clear = archR + 0.04
  const fit = ([x, y]: Vec2): Vec2 => {
    let px = x
    let py = Math.min(belt(x) - 0.03, Math.max(sill + 0.05, y))
    for (const cx of [frontAxle, rearAxle]) {
      const d = Math.hypot(px - cx, py - r)
      if (d < clear && d > 0) {
        px = cx + ((px - cx) * clear) / d
        py = r + ((py - r) * clear) / d
      }
    }
    return v2(px, py)
  }
  const driver: 1 | -1 = body.steering === 'left' ? -1 : 1
  const door = (id: PartId, side: 1 | -1, shape: Frac[]): Door => {
    const outline = shape.map(pt).map(fit)
    const xs = outline.map((p) => p[0])
    const ys = outline.map((p) => p[1])
    return {
      id, side, outline, z: round(side * (W / 2 + PANEL)),
      x0: Math.max(...xs), x1: Math.min(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
    }
  }
  const doors = [
    door('door_driver', driver, FRONT_DOOR),
    door('door_passenger', -driver as 1 | -1, FRONT_DOOR),
    door('door_rear_left', -1, REAR_DOOR),
    door('door_rear_right', 1, REAR_DOOR),
  ]

  // ---- hood and tailgate: strips along the outline, a little proud of it ----
  const lift = ([x, y]: Vec2): Vec2 => v2(x, y + 0.012)
  const hoodLine = NOSE.slice(-HOOD_POINTS).reverse().map(pt).map(lift)
  const hood = { hinge: hoodLine[0], tip: hoodLine[hoodLine.length - 1], width: round(0.86 * W), line: hoodLine }
  const trunkLine = [pt(TAILGATE_HINGE), ...CABIN.slice(-3).map(pt), ...TAIL.slice(1, TAILGATE_FOOT + 1).map(pt)]
  const trunk = {
    hinge: trunkLine[0], knee: deck, foot: trunkLine[trunkLine.length - 1], width: round(0.84 * W), line: trunkLine,
  }

  // ---- where the labels point ----
  const byId = <T extends { id: PartId }>(list: T[], id: PartId) => list.find((p) => p.id === id)!
  const mid = hoodLine[Math.floor(hoodLine.length / 2)]
  const noseTop = hoodLine[hoodLine.length - 1][1]
  const anchors: Record<PartId, Anchor> = {
    wheel_fl: wheelAnchor(byId(wheels, 'wheel_fl'), track),
    wheel_fr: wheelAnchor(byId(wheels, 'wheel_fr'), track),
    wheel_rl: wheelAnchor(byId(wheels, 'wheel_rl'), track),
    wheel_rr: wheelAnchor(byId(wheels, 'wheel_rr'), track),
    door_driver: doorAnchor(byId(doors, 'door_driver'), W),
    door_passenger: doorAnchor(byId(doors, 'door_passenger'), W),
    door_rear_left: doorAnchor(byId(doors, 'door_rear_left'), W),
    door_rear_right: doorAnchor(byId(doors, 'door_rear_right'), W),
    trunk: { pos: v3(X(1.93), (deck[1] + trunk.foot[1]) / 2, 0), normal: [-1, 0, 0] },
    hood: { pos: v3(mid[0], mid[1] + 0.02, 0), normal: null },
    // points inside the car (the tank under the rear seat, the engine between the front wheels, the dashboard
    // behind the windshield on the driver's side), so they are never "on the far side"
    fuel: { pos: v3(rearAxle + 0.45, sill + 0.12, 0), normal: null },
    engine: { pos: v3(frontAxle + 0.05, (sill + noseTop) / 2, 0), normal: null },
    dash: { pos: v3(cowl[0] - 0.3, cowl[1] + 0.03, driver * 0.2 * W), normal: null },
  }

  return {
    body, lower, cabin, cabinWidth: round(0.86 * W), wheels, doors, hood, trunk, anchors,
    centre: v3(0, H * 0.42, 0),
    radius: round(Math.hypot(L / 2, H / 2, W / 2)),
  }
}
