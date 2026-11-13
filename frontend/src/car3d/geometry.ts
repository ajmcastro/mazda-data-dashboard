// The shape of the schematic car (PLAN.md M39, M42): picks the model's shape and builds its geometry.
// Pure numbers, no three.js. `shapes/common.ts` has the types, `shapes/generic.ts` the generic SUV and
// `shapes/cx60.ts` a model's own outline; this file is what the rest of the app imports.
//
// Axes (metres): x along the car with the FRONT at +x, y up with the ground at 0, z across with the car's RIGHT
// side at +z (so the left side is -z). The origin is under the middle of the car's length.

import { saneBody, type Anchor, type Body, type CarGeometry, type ShapeName, type Vec3 } from './shapes/common'
import { cx60Geometry } from './shapes/cx60'
import { genericGeometry } from './shapes/generic'

export { DEFAULT_BODY, SHAPES, bodyOfModel, saneBody } from './shapes/common'
export type { Anchor, Body, CarGeometry, Door, ModelBody, ShapeName, Vec2, Vec3, Wheel } from './shapes/common'

const BUILDERS: Record<ShapeName, (body: Body) => CarGeometry> = { generic: genericGeometry, cx60: cx60Geometry }

export function carGeometry(input?: Partial<Body>): CarGeometry {
  const body = saneBody(input)
  return BUILDERS[body.shape](body)
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
