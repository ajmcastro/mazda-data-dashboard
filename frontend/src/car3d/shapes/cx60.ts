// The Mazda CX-60's own outline (PLAN.md M42, M43): traced by hand from the owner's photo of the car's left
// side, the widths across the car judged by eye from the front and rear photos. `traced.ts` explains the
// fractions and builds the car. The photo was taken close with a wide lens, so heights were normalised to the
// roof, the rear reduced a little and the hood's rise flattened.
//
// What it shows that the generic shape does not: the long hood, the cabin set far back (the windshield starts
// a fifth of the wheelbase behind the front axle), the roof highest over the front seats and falling to a
// raked tail, the short rear overhang, and the rear door's edge running over the rear wheel arch.

import type { Body, CarGeometry } from './common'
import { tracedGeometry, type Traced } from './traced'

const SILL = 0.133
const DOOR_GAP = 0.006

export const CX60: Traced = {
  frontShare: 0.42,
  sill: SILL,
  nose: [
    [-0.89, SILL], [-0.988, 0.194], [-1, 0.365], [-0.97, 0.467], [-0.89, 0.551], [-0.598, 0.596], [0.003, 0.656],
    [0.137, 0.69], [0.205, 0.7],
  ],
  hoodPoints: 5,
  cabin: [
    [0.205, 0.7], [0.303, 0.836], [0.404, 0.905], [0.48, 0.952], [0.567, 0.99], [0.675, 1], [0.81, 0.988],
    [0.945, 0.957], [1.258, 0.918], [1.52, 0.899], [1.677, 0.807], [1.834, 0.716],
  ],
  // the tail lights are the rearmost point
  tail: [[1.834, 0.716], [1.913, 0.651], [2, 0.615], [1.934, 0.517], [1.913, 0.421], [1.873, 0.26], [1.803, 0.217]],
  tailgateHinge: [1.45, 0.905],
  tailgateFoot: 4,
  // the pillar between the doors leans back, the rear door ends over the wheel arch
  frontDoor: [[0.239, 0.705], [0.251, SILL], [0.605 - DOOR_GAP, SILL], [0.646 - DOOR_GAP, 0.682]],
  rearDoor: [
    [0.646 + DOOR_GAP, 0.682], [0.605 + DOOR_GAP, SILL], [0.832, SILL], [0.857, 0.311], [0.911, 0.389], [0.978, 0.459],
    [1.052, 0.512], [1.083, 0.626], [0.997, 0.684],
  ],
  pillars: [[0.61, 0.67, 0.705, 0.655], [1.02, 1.07, 1.0, 0.96]],
  quarter: [1.3, 1.12],
  noseWidth: 0.8, noseRound: 0.2, tailWidth: 0.88, tailRound: 0.1, cabinBelt: 0.93, cabinRoof: 0.74,
  details: [
    { name: 'grille', tone: 'trim', at: [-0.995, 0.4], across: 0, size: (b) => [0.03, 0.2 * b.height, 0.5 * b.width] },
    { name: 'headlight', tone: 'lamp', at: [-0.945, 0.515], across: 0.74, size: () => [0.05, 0.045, 0.3] },
    { name: 'tail light', tone: 'lamp', at: [1.985, 0.615], across: 0.62, size: () => [0.04, 0.06, 0.52] },
    { name: 'mirror', tone: 'trim', at: [0.33, 0.725], across: 1.12, size: () => [0.12, 0.1, 0.2] },
  ],
  fuelFlap: { at: [1.2, 0.55], size: [0.24, 0.22, 0.02] },
  trunkLabel: 1.93,
  spokes: 5,
}

export const cx60Geometry = (body: Body): CarGeometry => tracedGeometry(body, CX60)
