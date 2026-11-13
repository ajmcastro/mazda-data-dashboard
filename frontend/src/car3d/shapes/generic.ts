// The generic SUV (PLAN.md M39): the shape of every model that has no outline of its own. Its numbers are pinned
// by `generic.fixture.json`: a model drawn with it must look exactly as it did before shapes had names (M42).

import type { PartId } from '../../car'
import {
  ARCH_GAP, ARCH_STEPS, PANEL, TIRE_WIDTH, round, v2, v3,
  type Anchor, type Body, type CarGeometry, type Door, type Vec2, type Wheel,
} from './common'

export function genericGeometry(body: Body): CarGeometry {
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
    outline: [v2(x0, sill + 0.07), v2(x1, sill + 0.07), v2(x1, belt - 0.03), v2(x0, belt - 0.03)],
  })
  const doors = [
    door('door_driver', driver, doorFront, pillar + 0.02),
    door('door_passenger', -driver as 1 | -1, doorFront, pillar + 0.02),
    door('door_rear_left', -1, pillar - 0.02, doorRear),
    door('door_rear_right', 1, pillar - 0.02, doorRear),
  ]

  const hoodHinge = v2(cowl[0] + 0.04, cowl[1] + 0.012)
  const hoodTip = v2(xF - 0.14, nose + 0.012)
  const hood = { hinge: hoodHinge, tip: hoodTip, width: round(0.86 * W), line: [hoodHinge, hoodTip] }
  const trunkHinge = v2(roofRear[0] - 0.02, roofRear[1])
  const trunkFoot = v2(xR, sill + 0.34)
  const trunk = { hinge: trunkHinge, knee: deck, foot: trunkFoot, width: round(0.84 * W), line: [trunkHinge, deck, trunkFoot] }

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
