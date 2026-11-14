/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PartId } from '../car'
import {
  DEFAULT_BODY, SHAPES, bodyOfModel, cabinHalfWidthAt, carGeometry, facesCamera, halfWidthAt, planShiftAt, saneBody,
  type Body, type CarGeometry,
} from './geometry'
import fixture from './shapes/generic.fixture.json'

const PARTS: PartId[] = [
  'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'door_driver', 'door_passenger', 'door_rear_left',
  'door_rear_right', 'trunk', 'hood', 'fuel', 'engine', 'dash',
]

describe('carGeometry', () => {
  const g = carGeometry()
  const wheel = (id: PartId) => g.wheels.find((w) => w.id === id)!
  const door = (id: PartId) => g.doors.find((d) => d.id === id)!

  it('puts the wheels a wheelbase and a track apart, standing on the ground', () => {
    expect(wheel('wheel_fl').centre[0] - wheel('wheel_rl').centre[0]).toBeCloseTo(DEFAULT_BODY.wheelbase, 3)
    expect(wheel('wheel_fr').centre[2] - wheel('wheel_fl').centre[2]).toBeCloseTo(DEFAULT_BODY.track, 3)
    for (const w of g.wheels) expect(w.centre[1]).toBeCloseTo(w.radius, 3)
    // left is -z, right is +z, front is +x
    expect(wheel('wheel_fl').centre[2]).toBeLessThan(0)
    expect(wheel('wheel_rr').centre[2]).toBeGreaterThan(0)
    expect(wheel('wheel_fl').centre[0]).toBeGreaterThan(wheel('wheel_rl').centre[0])
  })

  it('keeps the whole outline inside the car\'s length and height, above the ground', () => {
    for (const [x, y] of [...g.lower, ...g.cabin]) {
      expect(Math.abs(x)).toBeLessThanOrEqual(DEFAULT_BODY.length / 2 + 1e-9)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThanOrEqual(DEFAULT_BODY.height + 1e-9)
    }
    expect(Math.max(...g.cabin.map((p) => p[1]))).toBeCloseTo(DEFAULT_BODY.height, 3)
    expect(g.cabinWidth).toBeLessThan(DEFAULT_BODY.width)
  })

  it('cuts an arch over each axle that clears the tire', () => {
    for (const w of g.wheels.filter((x) => x.side === -1)) {
      const over = g.lower.filter(([x]) => Math.abs(x - w.centre[0]) < 0.02)
      expect(over.length).toBeGreaterThan(0)
      for (const [, y] of over) expect(y).toBeGreaterThan(2 * w.radius)
    }
  })

  it('fits two doors a side between the arches, the rear one behind the front one', () => {
    for (const side of [-1, 1]) {
      const [front, rear] = g.doors.filter((d) => d.side === side).sort((a, b) => b.x0 - a.x0)
      expect(front.x0).toBeLessThan(wheel('wheel_fl').centre[0] - wheel('wheel_fl').radius)
      expect(rear.x1).toBeGreaterThan(wheel('wheel_rl').centre[0] + wheel('wheel_rl').radius)
      expect(front.x1).toBeLessThan(front.x0) // a door runs back from its hinge
      expect(rear.x0).toBeLessThanOrEqual(front.x1 + 0.05)
      expect(front.x0 - front.x1).toBeGreaterThan(0.6)
      expect(rear.x0 - rear.x1).toBeGreaterThan(0.6)
    }
  })

  it('draws the driver\'s door on the side the steering wheel is', () => {
    expect(door('door_driver').side).toBe(-1)
    expect(door('door_passenger').side).toBe(1)
    const rhd = carGeometry({ steering: 'right' })
    expect(rhd.doors.find((d) => d.id === 'door_driver')!.side).toBe(1)
    expect(rhd.doors.find((d) => d.id === 'door_passenger')!.side).toBe(-1)
    expect(rhd.anchors.dash.pos[2]).toBeGreaterThan(0)
    expect(g.anchors.dash.pos[2]).toBeLessThan(0)
    // the rear doors are named by side in the data, so they do not move
    expect(rhd.doors.find((d) => d.id === 'door_rear_left')!.side).toBe(-1)
  })

  it('has a point for every part, on or inside the car', () => {
    expect(Object.keys(g.anchors).sort()).toEqual([...PARTS].sort())
    for (const id of PARTS) {
      const [x, y, z] = g.anchors[id].pos
      expect(Math.abs(x)).toBeLessThanOrEqual(DEFAULT_BODY.length / 2 + 0.01)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThanOrEqual(DEFAULT_BODY.height)
      expect(Math.abs(z)).toBeLessThanOrEqual(DEFAULT_BODY.width / 2 + 0.05)
    }
    expect(g.anchors.wheel_fl.normal).toEqual([0, 0, -1])
    expect(g.anchors.fuel.normal).toBeNull()
    expect(g.anchors.engine.pos[0]).toBeGreaterThan(0)
    expect(g.anchors.fuel.pos[0]).toBeLessThan(0)
  })

  it('hinges the hood at the windshield and the tailgate at the roof', () => {
    expect(g.hood.tip[0]).toBeGreaterThan(g.hood.hinge[0])
    expect(g.hood.tip[1]).toBeLessThan(g.hood.hinge[1])
    expect(g.trunk.hinge[1]).toBeGreaterThan(g.trunk.knee[1])
    expect(g.trunk.knee[1]).toBeGreaterThan(g.trunk.foot[1])
    expect(g.trunk.foot[0]).toBeCloseTo(-DEFAULT_BODY.length / 2, 3)
  })

  it('follows a model\'s own dimensions', () => {
    const long = carGeometry({ length: 4.745, wheelbase: 2.87, width: 1.89 })
    expect(long.wheels[0].centre[0] - long.wheels[2].centre[0]).toBeCloseTo(2.87, 3)
    expect(long.radius).toBeGreaterThan(g.radius)
    expect(Math.max(...long.lower.map((p) => p[0]))).toBeCloseTo(4.745 / 2, 2)
  })

  it('is the same every time (no randomness)', () => {
    expect(carGeometry()).toEqual(carGeometry())
  })
})

describe('saneBody', () => {
  it('falls back to drawable values for nonsense', () => {
    const b = saneBody({ length: -1, width: 99, height: Number.NaN, wheelbase: 40, track: 0, wheelDiameter: 5 })
    expect(b.length).toBe(DEFAULT_BODY.length)
    expect(b.width).toBe(DEFAULT_BODY.width)
    expect(b.height).toBe(DEFAULT_BODY.height)
    expect(b.wheelDiameter).toBe(DEFAULT_BODY.wheelDiameter)
    expect(b.wheelbase).toBeLessThan(b.length)
    expect(b.track).toBeLessThan(b.width)
    expect(saneBody(undefined)).toEqual(DEFAULT_BODY)
  })

  it('always leaves room for the arches and the doors', () => {
    for (const length of [3.6, 4.2, 5, 6]) for (const wheelDiameter of [0.5, 0.72, 0.9]) {
      const g = carGeometry({ length, wheelDiameter })
      for (const d of g.doors) expect(d.x0 - d.x1).toBeGreaterThan(0.25)
      for (const [x] of g.lower) expect(Math.abs(x)).toBeLessThanOrEqual(length / 2 + 1e-9)
    }
  })
})

describe('bodyOfModel', () => {
  it('turns the API\'s millimetres into metres and keeps the steering side', () => {
    const body = bodyOfModel({ length_mm: 4745, width_mm: 1890, height_mm: 1680, wheelbase_mm: 2870, track_mm: 1640, wheel_diameter_mm: 745, steering: 'right' })
    expect(body).toEqual({ length: 4.745, width: 1.89, height: 1.68, wheelbase: 2.87, track: 1.64, wheelDiameter: 0.745, steering: 'right' })
    const g = carGeometry(body)
    expect(g.body.length).toBe(4.745)
    expect(g.doors.find((d) => d.id === 'door_driver')!.side).toBe(1)
  })

  it('leaves out what the model does not give, so the generic car fills it in', () => {
    expect(bodyOfModel({ length_mm: 4745, width_mm: null, steering: 'left' })).toEqual({ length: 4.745, steering: 'left' })
    expect(carGeometry(bodyOfModel({ length_mm: 4745, width_mm: null })).body.width).toBe(DEFAULT_BODY.width)
    expect(bodyOfModel(null)).toBeUndefined()
    expect(bodyOfModel(undefined)).toBeUndefined()
    expect(carGeometry(bodyOfModel(null))).toEqual(carGeometry())
  })

  it('makes a longer model visibly longer than a shorter one', () => {
    const cx5 = carGeometry(bodyOfModel({ length_mm: 4575, wheelbase_mm: 2700 }))
    const cx60 = carGeometry(bodyOfModel({ length_mm: 4745, wheelbase_mm: 2870 }))
    const length = (g: typeof cx5) => Math.max(...g.lower.map((p) => p[0])) - Math.min(...g.lower.map((p) => p[0]))
    expect(length(cx60) - length(cx5)).toBeCloseTo(0.17, 2)
    expect(cx60.wheels[0].centre[0] - cx60.wheels[2].centre[0]).toBeGreaterThan(cx5.wheels[0].centre[0] - cx5.wheels[2].centre[0])
  })
})

describe('facesCamera', () => {
  const g = carGeometry()
  it('is true for a part on the camera\'s side and false on the far side', () => {
    expect(facesCamera(g.anchors.wheel_fl, [3, 2, -6])).toBe(true)
    expect(facesCamera(g.anchors.wheel_fr, [3, 2, -6])).toBe(false)
    expect(facesCamera(g.anchors.trunk, [-6, 2, 0])).toBe(true)
    expect(facesCamera(g.anchors.trunk, [6, 2, 0])).toBe(false)
  })
  it('is always true for a point inside the car', () => {
    expect(facesCamera(g.anchors.fuel, [6, 2, 6])).toBe(true)
    expect(facesCamera(g.anchors.fuel, [-6, 2, -6])).toBe(true)
  })
})

// ---- shapes by name (PLAN.md M42) ----

const CX60: Partial<Body> = { length: 4.745, width: 1.89, height: 1.68, wheelbase: 2.87, track: 1.64, wheelDiameter: 0.745 }

describe('the generic shape', () => {
  /** What the geometry was before shapes had names: without the fields M42 added. */
  const before = (g: CarGeometry) => {
    const { shape: _shape, ...body } = g.body
    return JSON.parse(JSON.stringify({
      ...g, body,
      doors: g.doors.map(({ outline: _outline, ...d }) => d),
      hood: { hinge: g.hood.hinge, tip: g.hood.tip, width: g.hood.width },
      trunk: { hinge: g.trunk.hinge, knee: g.trunk.knee, foot: g.trunk.foot, width: g.trunk.width },
    }))
  }

  it('is exactly the car drawn before shapes had names', () => {
    expect(before(carGeometry())).toEqual(fixture.default)
    expect(before(carGeometry(CX60))).toEqual(fixture.cx60)
    expect(before(carGeometry({ steering: 'right', length: 4.2 }))).toEqual(fixture.rhd)
  })

  it('is what an unknown or missing shape name gives', () => {
    expect(saneBody({ shape: 'cx90' as never }).shape).toBe('generic')
    expect(bodyOfModel({ length_mm: 4745, shape: 'cx90' })).toEqual({ length: 4.745 })
    expect(bodyOfModel({ shape: 'cx60' })).toEqual({ shape: 'cx60' })
    expect(bodyOfModel({ shape: 'cx5' })).toEqual({ shape: 'cx5' })
    expect(carGeometry(bodyOfModel({ shape: null }))).toEqual(carGeometry())
  })

  it('has flat doors, a flat hood and a tailgate with one knee', () => {
    const g = carGeometry()
    for (const d of g.doors) expect(d.outline).toHaveLength(4)
    expect(g.hood.line).toEqual([g.hood.hinge, g.hood.tip])
    expect(g.trunk.line).toEqual([g.trunk.hinge, g.trunk.knee, g.trunk.foot])
  })
})

describe.each(SHAPES)('every shape: %s', (shape) => {
  const bodies: Partial<Body>[] = [{ shape }, { ...CX60, shape }, { shape, length: 3.6, wheelDiameter: 0.9 }, { shape, length: 6, wheelDiameter: 0.5, height: 2.2 }]

  it.each(bodies)('is drawable for %j', (input) => {
    const g = carGeometry(input)
    const { length: L, height: H, width: W } = g.body
    // outlines inside the car's length and height, above the ground
    for (const [x, y] of [...g.lower, ...g.cabin]) {
      expect(Math.abs(x)).toBeLessThanOrEqual(L / 2 + 1e-3) // points are rounded to the millimetre
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThanOrEqual(H + 1e-3)
    }
    expect(Math.max(...g.cabin.map((p) => p[1]))).toBeCloseTo(H, 2)
    expect(Math.max(...g.lower.map((p) => p[0]))).toBeCloseTo(L / 2, 2)
    expect(Math.min(...g.lower.map((p) => p[0]))).toBeCloseTo(-L / 2, 2)
    // wheels a wheelbase apart, on the ground, an arch over each that clears the tire
    const fl = g.wheels.find((w) => w.id === 'wheel_fl')!
    const rl = g.wheels.find((w) => w.id === 'wheel_rl')!
    expect(fl.centre[0] - rl.centre[0]).toBeCloseTo(g.body.wheelbase, 2)
    for (const w of [fl, rl]) {
      expect(w.centre[1]).toBeCloseTo(w.radius, 3)
      const over = g.lower.filter(([x]) => Math.abs(x - w.centre[0]) < 0.03)
      expect(over.length).toBeGreaterThan(0)
      for (const [, y] of over) expect(y).toBeGreaterThan(2 * w.radius)
    }
    // doors: hinged at the front, between the axles' arches, never inside an arch, under the glass
    for (const d of g.doors) {
      expect(d.x0).toBeGreaterThan(d.x1)
      expect(d.x0 - d.x1).toBeGreaterThan(0.25)
      expect(d.outline.length).toBeGreaterThanOrEqual(4)
      for (const [x, y] of d.outline) {
        expect(x).toBeLessThanOrEqual(d.x0 + 1e-9)
        expect(x).toBeGreaterThanOrEqual(d.x1 - 1e-9)
        for (const w of [fl, rl]) expect(Math.hypot(x - w.centre[0], y - w.centre[1])).toBeGreaterThan(w.radius + 0.05)
        expect(y).toBeLessThan(Math.max(...g.cabin.map((p) => p[1])))
      }
      expect(Math.abs(d.z)).toBeGreaterThan(W / 2)
    }
    // hood from the windshield forward and down, tailgate from the roof down the back
    expect(g.hood.line[0]).toEqual(g.hood.hinge)
    expect(g.hood.line.at(-1)).toEqual(g.hood.tip)
    expect(g.hood.tip[0]).toBeGreaterThan(g.hood.hinge[0])
    expect(g.hood.tip[1]).toBeLessThan(g.hood.hinge[1])
    expect(g.trunk.line[0]).toEqual(g.trunk.hinge)
    expect(g.trunk.line.at(-1)).toEqual(g.trunk.foot)
    expect(g.trunk.hinge[1]).toBeGreaterThan(g.trunk.knee[1])
    expect(g.trunk.knee[1]).toBeGreaterThan(g.trunk.foot[1])
    // a point for every part, on or inside the car
    expect(Object.keys(g.anchors).sort()).toEqual([...PARTS].sort())
    for (const id of PARTS) {
      const [x, y, z] = g.anchors[id].pos
      expect(Math.abs(x)).toBeLessThanOrEqual(L / 2 + 0.01)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThanOrEqual(H)
      expect(Math.abs(z)).toBeLessThanOrEqual(W / 2 + 0.05)
    }
    expect(carGeometry(input)).toEqual(g)
  })

  it('draws the driver\'s door on the steering side', () => {
    const side = (steering: 'left' | 'right') => carGeometry({ shape, steering }).doors.find((d) => d.id === 'door_driver')!.side
    expect(side('left')).toBe(-1)
    expect(side('right')).toBe(1)
    expect(carGeometry({ shape, steering: 'right' }).anchors.dash.pos[2]).toBeGreaterThan(0)
  })
})

describe('the CX-60 shape', () => {
  const generic = carGeometry({ ...CX60, shape: 'generic' })
  const cx60 = carGeometry({ ...CX60, shape: 'cx60' })
  const axle = (g: CarGeometry, id: 'wheel_fl' | 'wheel_rl') => g.wheels.find((w) => w.id === id)!.centre[0]

  it('is picked by its name and keeps the model\'s dimensions', () => {
    expect(cx60.body).toMatchObject({ ...CX60, shape: 'cx60' })
    expect(cx60.lower).not.toEqual(generic.lower)
    expect(cx60.radius).toBe(generic.radius)
  })

  it('has a long hood: the windshield starts well behind the front axle, further back than on the generic car', () => {
    const cowl = (g: CarGeometry) => g.hood.hinge[0]
    expect(axle(cx60, 'wheel_fl') - cowl(cx60)).toBeGreaterThan(0.5)
    expect(axle(cx60, 'wheel_fl') - cowl(cx60)).toBeGreaterThan(axle(generic, 'wheel_fl') - cowl(generic))
    expect(cx60.hood.line.length).toBeGreaterThan(2) // a curved hood, not a flat board
  })

  it('has its roof highest over the front seats, falling towards the tail', () => {
    const top = cx60.cabin.reduce((a, b) => (b[1] > a[1] ? b : a))
    const middle = (axle(cx60, 'wheel_fl') + axle(cx60, 'wheel_rl')) / 2
    expect(top[0]).toBeLessThan(middle + 0.6)
    expect(top[0]).toBeGreaterThan(middle - 0.6)
    const roofEnd = cx60.trunk.hinge
    expect(roofEnd[1]).toBeLessThan(top[1] - 0.1)
  })

  it('has a shorter overhang in front than behind, and the tail lights as its rearmost point', () => {
    const { length: L } = cx60.body
    expect(L / 2 - axle(cx60, 'wheel_fl')).toBeLessThan(axle(cx60, 'wheel_rl') + L / 2)
    const rearmost = cx60.lower.reduce((a, b) => (b[0] < a[0] ? b : a))
    expect(rearmost[1]).toBeGreaterThan(0.5 * cx60.body.height)
    expect(rearmost[1]).toBeLessThan(0.7 * cx60.body.height)
  })

  it('cuts the rear door over the wheel arch and leans the pillar between the doors back', () => {
    const front = cx60.doors.find((d) => d.id === 'door_driver')!
    const rear = cx60.doors.find((d) => d.id === 'door_rear_left')!
    expect(rear.outline.length).toBeGreaterThan(4)
    expect(rear.x1).toBeLessThan(axle(cx60, 'wheel_rl')) // its top corner is behind the rear axle
    // the pillar leans: the front door is longer at the bottom than at the top
    const [topFront, bottomFront, bottomRear, topRear] = front.outline
    expect(bottomFront[0] - bottomRear[0]).toBeLessThan(topFront[0] - topRear[0])
    expect(front.x0 - front.x1).toBeGreaterThan(1)
  })
})

describe('shaping across the car and details (M43)', () => {
  const generic = carGeometry({ ...CX60, shape: 'generic' })
  const cx60 = carGeometry({ ...CX60, shape: 'cx60' })
  const style = cx60.style!
  const half = cx60.body.width / 2
  const L = cx60.body.length
  const xs = Array.from({ length: 41 }, (_, i) => -L / 2 + (L * i) / 40)

  it('leaves the generic car a plain slab', () => {
    expect(generic.style).toBeUndefined()
    for (const x of xs) {
      expect(halfWidthAt(generic, x)).toBe(generic.body.width / 2)
      expect(cabinHalfWidthAt(generic, x, 1.5)).toBe(generic.body.width / 2)
      expect(planShiftAt(generic, x)).toBe(0)
    }
  })

  it('is full width between the axles and narrows towards the nose and the tail, never wider than the car', () => {
    const [front, rear] = [cx60.wheels[0].centre[0], cx60.wheels[2].centre[0]]
    for (const x of xs) {
      const w = halfWidthAt(cx60, x)
      expect(w).toBeLessThanOrEqual(half + 1e-9)
      expect(w).toBeGreaterThan(0.7 * half)
      if (x <= front && x >= rear) expect(w).toBeCloseTo(half, 6) // the wheels and doors sit here
    }
    expect(halfWidthAt(cx60, L / 2)).toBeCloseTo(style.noseWidth * half, 6)
    expect(halfWidthAt(cx60, -L / 2)).toBeCloseTo(style.tailWidth * half, 6)
    // narrowing only ever goes one way from the middle
    const widths = xs.filter((x) => x >= front).map((x) => halfWidthAt(cx60, x))
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 1e-9)
  })

  it('leans the cabin in: narrower at the roof than where the glass starts, never wider than the body', () => {
    const H = cx60.body.height
    expect(cabinHalfWidthAt(cx60, 0, style.beltY)).toBeCloseTo(style.cabinBelt * half, 6)
    expect(cabinHalfWidthAt(cx60, 0, H)).toBeCloseTo(style.cabinRoof * half, 6)
    expect(cabinHalfWidthAt(cx60, 0, H)).toBeLessThan(cabinHalfWidthAt(cx60, 0, style.beltY))
    for (const y of [0, style.beltY, (style.beltY + H) / 2, H, H + 1]) expect(cabinHalfWidthAt(cx60, 0, y)).toBeLessThanOrEqual(half)
  })

  it('rounds the nose back and the tail forward, and nothing in between', () => {
    expect(planShiftAt(cx60, L / 2)).toBeCloseTo(style.noseRound, 6)
    expect(planShiftAt(cx60, -L / 2)).toBeCloseTo(-style.tailRound, 6)
    expect(planShiftAt(cx60, 0)).toBe(0)
  })

  it('keeps the roof and the pillars on the cabin', () => {
    const H = cx60.body.height
    const cabinXs = cx60.cabin.map((p) => p[0])
    for (const [x, y] of [...style.roof, ...style.pillars.flat()]) {
      expect(x).toBeGreaterThanOrEqual(Math.min(...cabinXs) - 0.12)
      expect(x).toBeLessThanOrEqual(Math.max(...cabinXs) + 1e-6)
      expect(y).toBeGreaterThan(0.6 * H)
      expect(y).toBeLessThanOrEqual(H + 0.02)
    }
    expect(style.pillars.length).toBeGreaterThanOrEqual(3)
    for (const pillar of style.pillars) expect(pillar.length).toBeGreaterThanOrEqual(4)
  })

  it('puts every detail on the car, in a neutral tone, the same on both sides', () => {
    const H = cx60.body.height
    for (const d of style.details) {
      expect(['trim', 'lamp', 'panel']).toContain(d.tone)
      expect(Math.abs(d.centre[0])).toBeLessThanOrEqual(L / 2 + 0.01)
      expect(d.centre[1]).toBeGreaterThan(0.2 * H)
      expect(d.centre[1]).toBeLessThan(H)
      expect(Math.abs(d.centre[2])).toBeLessThanOrEqual(half + 0.15) // the mirrors stand out a little
    }
    for (const name of ['headlight', 'tail light', 'mirror']) {
      const [left, right] = [style.details.find((d) => d.name === `${name} left`)!, style.details.find((d) => d.name === `${name} right`)!]
      expect(left.centre[2]).toBeCloseTo(-right.centre[2], 6)
      expect([left.centre[0], left.centre[1], left.size]).toEqual([right.centre[0], right.centre[1], right.size])
    }
    expect(style.details.find((d) => d.name === 'grille')!.centre[2]).toBe(0)
    expect(style.details.find((d) => d.name === 'headlight left')!.centre[0]).toBeGreaterThan(cx60.wheels[0].centre[0])
    expect(style.details.find((d) => d.name === 'tail light left')!.centre[0]).toBeLessThan(cx60.wheels[2].centre[0])
    expect(style.spokes).toBe(5)
  })

  it('points the fuel label at the flap, on the left rear quarter', () => {
    const flap = style.details.find((d) => d.name === 'fuel flap')!
    expect(cx60.anchors.fuel.pos).toEqual(flap.centre)
    expect(cx60.anchors.fuel.normal).toEqual([0, 0, -1])
    expect(flap.centre[2]).toBeLessThan(0) // left
    expect(flap.centre[0]).toBeLessThan(cx60.wheels[2].centre[0]) // behind the rear axle
    expect(style.details.filter((d) => d.name.startsWith('fuel flap'))).toHaveLength(1)
    expect(generic.anchors.fuel.normal).toBeNull()
  })
})

describe('the CX-5 shape (M44)', () => {
  const CX5_BODY: Partial<Body> = { length: 4.69, width: 1.86, height: 1.695, wheelbase: 2.815, track: 1.595, wheelDiameter: 0.73 }
  const cx5 = carGeometry({ ...CX5_BODY, shape: 'cx5' })
  const cx60 = carGeometry({ ...CX60, shape: 'cx60' })
  const axle = (g: CarGeometry, id: 'wheel_fl' | 'wheel_rl') => g.wheels.find((w) => w.id === id)!.centre[0]
  /** A length along the car as a share of that car's wheelbase, so the two cars can be compared. */
  const share = (g: CarGeometry, metres: number) => metres / g.body.wheelbase

  it('is picked by its name, keeps the model\'s dimensions and is shaped across the car', () => {
    expect(cx5.body).toMatchObject({ ...CX5_BODY, shape: 'cx5' })
    expect(cx5.style).toBeDefined()
    expect(cx5.lower).not.toEqual(carGeometry({ ...CX5_BODY, shape: 'generic' }).lower)
  })

  it('has a shorter hood than the CX-60: its windshield starts closer to the front axle', () => {
    const behindAxle = (g: CarGeometry) => share(g, axle(g, 'wheel_fl') - g.hood.hinge[0])
    expect(behindAxle(cx5)).toBeGreaterThan(0.1)
    expect(behindAxle(cx5)).toBeLessThan(behindAxle(cx60))
  })

  it('has a flatter roof than the CX-60: it is still nearly full height over the rear axle', () => {
    const overRearAxle = (g: CarGeometry) => {
      const pts = [...g.cabin].sort((a, b) => a[0] - b[0])
      const x = axle(g, 'wheel_rl')
      const i = pts.findIndex((p) => p[0] >= x)
      const [a, b] = [pts[i - 1], pts[i]]
      return (a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])) / g.body.height
    }
    expect(overRearAxle(cx5)).toBeGreaterThan(0.97)
    expect(overRearAxle(cx5)).toBeGreaterThan(overRearAxle(cx60))
  })

  it('has a taller sill and overhangs of nearly the same length', () => {
    const sill = (g: CarGeometry) => Math.min(...g.lower.map((p) => p[1])) / g.body.height
    expect(sill(cx5)).toBeGreaterThan(sill(cx60))
    const front = cx5.body.length / 2 - axle(cx5, 'wheel_fl')
    const rear = axle(cx5, 'wheel_rl') + cx5.body.length / 2
    expect(Math.abs(front - rear)).toBeLessThan(0.1)
  })

  it('ends the rear door just ahead of the rear axle, with the tail lights high and rearmost', () => {
    const rear = cx5.doors.find((d) => d.id === 'door_rear_left')!
    expect(rear.x1).toBeGreaterThan(axle(cx5, 'wheel_rl'))
    expect(rear.outline.length).toBeGreaterThan(4)
    const rearmost = cx5.lower.reduce((a, b) => (b[0] < a[0] ? b : a))
    expect(rearmost[1] / cx5.body.height).toBeGreaterThan(0.6)
  })

  it('has its fuel flap on the left rear quarter, behind the rear axle, and the label on it', () => {
    const flap = cx5.style!.details.find((d) => d.name === 'fuel flap')!
    expect(flap.centre[2]).toBeLessThan(0)
    expect(flap.centre[0]).toBeLessThan(axle(cx5, 'wheel_rl'))
    expect(cx5.anchors.fuel).toEqual({ pos: flap.centre, normal: [0, 0, -1] })
  })

  it('has the same kinds of details as the CX-60, all neutral', () => {
    const names = (g: CarGeometry) => g.style!.details.map((d) => d.name).sort()
    expect(names(cx5)).toEqual(names(cx60))
    for (const d of cx5.style!.details) expect(['trim', 'lamp', 'panel']).toContain(d.tone)
  })
})

describe('the shape names', () => {
  it('are the same in the backend, which checks a model.yaml against them', () => {
    const py = readFileSync(new URL('../../../backend/src/mazda_dash/models.py', import.meta.url), 'utf8')
    const tuple = /^SHAPES = \(([^)]*)\)/m.exec(py)
    expect(tuple, 'SHAPES = (...) in models.py').not.toBeNull()
    expect([...tuple![1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1])).toEqual([...SHAPES])
  })
})
