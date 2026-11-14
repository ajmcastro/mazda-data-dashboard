// The Mazda CX-5's own outline (PLAN.md M44), the generation sold from 2026: traced by hand from the owner's
// photo of the car's left side, the widths across the car judged by eye from the front, rear and two high
// three-quarter photos. `traced.ts` explains the fractions and builds the car. This photo was taken from
// further away than the CX-60's, so the trace needed no correction: wheelbase, height and wheel size in the
// photo agree with the published figures to within a percent.
//
// Against the CX-60: a shorter hood (the windshield starts a sixth of the wheelbase behind the front axle), a
// flatter and longer roof ending in a longer spoiler, a more upright tail with the lights high up, a taller
// sill (the dark cladding), and a rear door that ends just ahead of the rear axle.

import type { Body, CarGeometry } from './common'
import { tracedGeometry, type Traced } from './traced'

const SILL = 0.166
const DOOR_GAP = 0.006

export const CX5: Traced = {
  frontShare: 0.486,
  sill: SILL,
  nose: [
    [-0.828, SILL], [-0.962, 0.191], [-1, 0.341], [-0.995, 0.491], [-0.986, 0.559], [-0.708, 0.629], [-0.455, 0.664],
    [0, 0.699], [0.122, 0.717], [0.169, 0.705],
  ],
  hoodPoints: 6,
  cabin: [
    [0.169, 0.705], [0.305, 0.843], [0.397, 0.927], [0.488, 0.973], [0.521, 0.987], [0.642, 1], [0.795, 0.999],
    [0.917, 0.989], [1.14, 0.972], [1.602, 0.943], [1.679, 0.846], [1.891, 0.728],
  ],
  // the tail lights are the rearmost point, high on the tail
  tail: [[1.891, 0.728], [2, 0.661], [1.977, 0.518], [1.986, 0.386], [1.891, 0.234], [1.633, 0.184]],
  tailgateHinge: [1.3, 0.96],
  tailgateFoot: 3,
  frontDoor: [[0.177, 0.678], [0.195, SILL], [0.545 - DOOR_GAP, SILL], [0.565 - DOOR_GAP, 0.694]],
  rearDoor: [
    [0.565 + DOOR_GAP, 0.694], [0.545 + DOOR_GAP, SILL], [0.819, SILL], [0.822, 0.24], [0.841, 0.361], [0.868, 0.442],
    [0.917, 0.503], [0.947, 0.544], [0.954, 0.646], [0.938, 0.713],
  ],
  pillars: [[0.55, 0.61, 0.63, 0.585], [0.94, 0.99, 0.93, 0.89]],
  quarter: [1.2, 1.02],
  noseWidth: 0.82, noseRound: 0.2, tailWidth: 0.9, tailRound: 0.1, cabinBelt: 0.93, cabinRoof: 0.76,
  details: [
    { name: 'grille', tone: 'trim', at: [-0.995, 0.4], across: 0, size: (b) => [0.03, 0.19 * b.height, 0.5 * b.width] },
    { name: 'headlight', tone: 'lamp', at: [-0.96, 0.54], across: 0.74, size: () => [0.05, 0.04, 0.3] },
    { name: 'tail light', tone: 'lamp', at: [1.985, 0.662], across: 0.62, size: () => [0.04, 0.05, 0.5] },
    { name: 'mirror', tone: 'trim', at: [0.318, 0.7], across: 1.12, size: () => [0.12, 0.1, 0.2] },
  ],
  fuelFlap: { at: [1.385, 0.597], size: [0.2, 0.2, 0.02] },
  trunkLabel: 1.95,
  spokes: 5,
}

export const cx5Geometry = (body: Body): CarGeometry => tracedGeometry(body, CX5)
