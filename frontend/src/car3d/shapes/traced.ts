// A car drawn from an outline traced off the owner's photos (PLAN.md M42–M44): the builder shared by every such
// shape (`cx60.ts`, `cx5.ts`), which only hold the numbers. A likeness, not a measured drawing and not a Mazda
// model file. A photo gives no measurements, so every traced point is a FRACTION, placed on the car by the
// model's published dimensions (length, height, wheelbase, wheel size from `body:` in its model.yaml).
//
// A point is [p, h]:
//   p  along the car, by the axles: -1 = the nose, 0 = the front axle, 1 = the rear axle, 2 = the tail;
//   h  height as a share of the car's height (0 = the ground, 1 = the roof's highest point).

import type { PartId } from '../../car'
import {
  ARCH_GAP, PANEL, archPoints, doorAnchor, halfWidthAt, heightOnLine, makeWheels, planShiftAt, round, v2, v3, wheelAnchor,
  type Anchor, type Body, type CarGeometry, type Detail, type Door, type Style, type Vec2,
} from './common'

export type Frac = readonly [number, number]

/** A block on the body's skin: where ([p, h]), how far from the centre line (0..1 of the half-width; 0 = one
 *  block in the middle, otherwise one on each side) and its size in metres (along, up, across). */
export interface SkinDetail {
  name: string
  tone: Detail['tone']
  at: Frac
  across: number
  size: (body: Body) => [number, number, number]
}

/** Everything that tells one traced car from another. */
export interface Traced {
  /** The front overhang's share of what is left of the length after the wheelbase. */
  frontShare: number
  /** Underside of the body (h). */
  sill: number
  /** From the bottom of the front bumper up the nose and back along the hood to the base of the windshield. */
  nose: Frac[]
  /** How many of the last points of `nose` are the hood (from its leading edge to the windshield). */
  hoodPoints: number
  /** The glass house: up the windshield, along the roof to the spoiler, down the rear window. Twelve points:
   *  the first four are the windshield, the fourth to the tenth the roof, the last four the rear quarter. */
  cabin: Frac[]
  /** From the base of the rear window down the tail to the bottom of the bumper. */
  tail: Frac[]
  /** Where the tailgate is hinged on the roof, and which point of `tail` it reaches down to. */
  tailgateHinge: Frac
  tailgateFoot: number
  /** The doors, front edge first. */
  frontDoor: Frac[]
  rearDoor: Frac[]
  /** Pillars between the side windows, each as [foot front, foot rear, top rear, top front] (p). */
  pillars: [number, number, number, number][]
  /** The solid quarter behind the last side window: from its foot (p) up to the roof (p). */
  quarter: [number, number]
  /** Seen from above and from the front: see `Style`. Widths as a share of half the body width. */
  noseWidth: number
  noseRound: number
  tailWidth: number
  tailRound: number
  cabinBelt: number
  cabinRoof: number
  details: SkinDetail[]
  /** The fuel flap ([p, h]) and its size; it is on the LEFT side of both cars traced so far. */
  fuelFlap: { at: Frac; size: [number, number, number] }
  /** Where the tailgate's label points (p). */
  trunkLabel: number
  spokes: number
}

export function tracedGeometry(body: Body, t: Traced): CarGeometry {
  const { length: L, width: W, height: H, wheelbase, track } = body
  const r = body.wheelDiameter / 2
  const xF = L / 2
  const xR = -L / 2
  const frontAxle = xF - (L - wheelbase) * t.frontShare
  const rearAxle = frontAxle - wheelbase
  /** p (see the top of the file) to metres along the car. */
  const X = (p: number) =>
    p < 0 ? frontAxle - p * (xF - frontAxle) : p <= 1 ? frontAxle - p * wheelbase : rearAxle - (p - 1) * (rearAxle - xR)
  const pt = ([p, h]: Frac): Vec2 => v2(X(p), h * H)
  const sill = t.sill * H
  const archR = r + ARCH_GAP
  const NOSE = t.nose
  const CABIN = t.cabin
  const TAIL = t.tail

  // ---- outlines: the lower body counter-clockwise from the rear bumper's bottom, with the two arches cut in ----
  // on an unusually short car with large wheels the bumpers' bottom corners would fall inside the arches: keep them out
  const reach = Math.sqrt(archR * archR - (r - sill) * (r - sill)) + 0.03
  const rearCorner = pt(TAIL[TAIL.length - 1])
  const frontCorner = pt(NOSE[0])
  const lower: Vec2[] = [
    v2(Math.min(rearCorner[0], rearAxle - reach), rearCorner[1]),
    ...archPoints(rearAxle, r, archR, sill),
    ...archPoints(frontAxle, r, archR, sill),
    v2(Math.max(frontCorner[0], frontAxle + reach), frontCorner[1]),
    ...NOSE.slice(1).map(pt),
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
    let py = Math.min(belt(x) - 0.06, Math.max(sill + 0.05, y)) // under the rounded shoulder
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
    door('door_driver', driver, t.frontDoor),
    door('door_passenger', -driver as 1 | -1, t.frontDoor),
    door('door_rear_left', -1, t.rearDoor),
    door('door_rear_right', 1, t.rearDoor),
  ]

  // ---- hood and tailgate: strips along the outline, a little proud of it ----
  const lift = ([x, y]: Vec2): Vec2 => v2(x, y + 0.012)
  const hoodLine = NOSE.slice(-t.hoodPoints).reverse().map(pt).map(lift)
  const hood = { hinge: hoodLine[0], tip: hoodLine[hoodLine.length - 1], width: round(0.86 * W), line: hoodLine }
  const trunkLine = [pt(t.tailgateHinge), ...CABIN.slice(-3).map(pt), ...TAIL.slice(1, t.tailgateFoot + 1).map(pt)]
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
    trunk: { pos: v3(X(t.trunkLabel), (deck[1] + trunk.foot[1]) / 2, 0), normal: [-1, 0, 0] },
    hood: { pos: v3(mid[0], mid[1] + 0.02, 0), normal: null },
    // points inside the car (the engine between the front wheels, the dashboard behind the windshield on the
    // driver's side), so they are never "on the far side"; the fuel label is moved to the flap further down
    fuel: { pos: v3(rearAxle + 0.45, sill + 0.12, 0), normal: null },
    engine: { pos: v3(frontAxle + 0.05, (sill + noseTop) / 2, 0), normal: null },
    dash: { pos: v3(cowl[0] - 0.3, cowl[1] + 0.03, driver * 0.2 * W), normal: null },
  }

  // ---- across the car and on it (M43): from the owner's front, rear and high photos, by eye ----
  const roofLine = CABIN.slice(3, 10).map(pt) // from the top of the windshield to the spoiler
  const under = (line: Vec2[], by: number) => [...line].reverse().map(([x, y]): Vec2 => v2(x, y - by))
  const roofY = (x: number) => heightOnLine(cabin, x) // the cabin's top edge over x (its points above the belt)
  const glassTop = (p: number): Vec2 => v2(X(p), roofY(X(p)) - 0.05)
  const glassFoot = (p: number): Vec2 => v2(X(p), belt(X(p)))
  const windshield = CABIN.slice(0, 4).map(pt)
  const style: Style = {
    noseFrom: frontAxle + 0.2, noseWidth: t.noseWidth, noseRound: t.noseRound,
    tailFrom: rearAxle - 0.35, tailWidth: t.tailWidth, tailRound: t.tailRound,
    beltY: round((cowl[1] + deck[1]) / 2), cabinBelt: t.cabinBelt, cabinRoof: t.cabinRoof,
    fillet: 0.05,
    // the band starts just above the glass, so the roof is solid seen from above too
    roof: [...roofLine.map(([x, y]): Vec2 => v2(x, y + 0.012)), ...under(roofLine, 0.05)],
    pillars: [
      // beside the windshield, between the side windows, and the solid quarter behind the last one
      [...windshield, ...[...windshield].reverse().map(([x, y]): Vec2 => v2(x - 0.11, y))],
      ...t.pillars.map(([a, b, c, d]) => [glassFoot(a), glassFoot(b), glassTop(c), glassTop(d)]),
      [glassFoot(t.quarter[0]), glassTop(t.quarter[1]), ...CABIN.slice(8).map(pt)],
    ],
    details: [],
    spokes: t.spokes,
  }
  const shaped = { body, style }
  const onSkin = ({ name, tone, at: [p, h], across, size }: SkinDetail): Detail[] => {
    const x = X(p)
    const z = across * halfWidthAt(shaped, x)
    const at = (side: 1 | -1): Detail => ({
      name: across === 0 ? name : `${name} ${side < 0 ? 'left' : 'right'}`, tone, size: size(body),
      centre: v3(x - planShiftAt(shaped, x) * across * across, h * H, side * z),
    })
    return across === 0 ? [at(1)] : [at(-1), at(1)]
  }
  const flapX = X(t.fuelFlap.at[0])
  const flap = v3(flapX, t.fuelFlap.at[1] * H, -halfWidthAt(shaped, flapX))
  style.details = [
    ...t.details.flatMap(onSkin),
    // the fuel flap is on the left rear quarter (seen in the photo): a single block, left side only
    { name: 'fuel flap', tone: 'panel', size: t.fuelFlap.size, centre: flap },
  ]
  anchors.fuel = { pos: flap, normal: [0, 0, -1] }

  return {
    body, lower, cabin, cabinWidth: round(0.86 * W), wheels, doors, hood, trunk, anchors, style,
    centre: v3(0, H * 0.42, 0),
    radius: round(Math.hypot(L / 2, H / 2, W / 2)),
  }
}
