import { describe, expect, it } from 'vitest'
import type { PartId } from '../car'
import { DEFAULT_BODY, bodyOfModel, carGeometry, facesCamera, saneBody } from './geometry'

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
