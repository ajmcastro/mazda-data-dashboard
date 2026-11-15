import { describe, expect, it } from 'vitest'
import { SHAPES, carGeometry } from './geometry'
import { profile, profileOf, sharedBox } from './profile'

describe.each(SHAPES)('the side view of the %s shape', (shape) => {
  const p = profile({ shape })
  const g = carGeometry({ shape })

  it('is as long and as high as the car, nose at the left, standing on the ground', () => {
    expect(p.length).toBeCloseTo(g.body.length, 1)
    expect(p.height).toBeGreaterThan(1.2)
    expect(p.height).toBeLessThanOrEqual(g.body.height + 0.01)
    const numbers = [...p.lower.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(numbers.length).toBeGreaterThan(8)
    for (const [x, y] of numbers) {
      expect(x).toBeGreaterThanOrEqual(-0.001)
      expect(x).toBeLessThanOrEqual(p.length + 0.001)
      expect(y).toBeGreaterThanOrEqual(-0.001)
      expect(y).toBeLessThanOrEqual(p.height + 0.001)
    }
  })
  it('has two wheels, the front one first, touching the ground', () => {
    expect(p.wheels).toHaveLength(2)
    expect(p.wheels[0].cx).toBeLessThan(p.wheels[1].cx)
    expect(p.wheels[1].cx - p.wheels[0].cx).toBeCloseTo(g.body.wheelbase, 1)
    for (const w of p.wheels) expect(w.cy + w.r).toBeCloseTo(p.height, 1)
  })
  it('has closed outlines for the body and the glass', () => {
    expect(p.lower.startsWith('M ') && p.lower.endsWith(' Z')).toBe(true)
    expect(p.cabin.startsWith('M ') && p.cabin.endsWith(' Z')).toBe(true)
    expect(profileOf(g)).toEqual(p)
  })
})

describe('several cars at one scale', () => {
  it('takes the longest and the highest, so a shorter car is drawn shorter', () => {
    const small = profile({ shape: 'cx5', length: 4.2, height: 1.5 })
    const big = profile({ shape: 'cx60', length: 4.9, height: 1.7 })
    const box = sharedBox([small, big])
    expect(box.length).toBe(Math.max(small.length, big.length))
    expect(box.height).toBe(Math.max(small.height, big.height))
    expect(small.length).toBeLessThan(big.length)
    expect(sharedBox([])).toEqual({ length: 0, height: 0 })
  })
})
