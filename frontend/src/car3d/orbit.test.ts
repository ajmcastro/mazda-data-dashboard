import { describe, expect, it } from 'vitest'
import { LIMITS, VIEWS, cameraPosition, clampOrbit, dragOrbit, keyOrbit, mixOrbit, viewOrbit, wrap, zoomOrbit } from './orbit'

const R = 2.6

describe('orbit', () => {
  it('never goes under the ground, straight overhead or inside the car', () => {
    const low = clampOrbit({ azimuth: 0, polar: 3, distance: 0.1 }, R)
    expect(low.polar).toBe(LIMITS.polarMax)
    expect(low.polar).toBeLessThan(Math.PI / 2)
    expect(low.distance).toBe(LIMITS.zoomIn * R)
    const high = clampOrbit({ azimuth: 0, polar: -1, distance: 999 }, R)
    expect(high.polar).toBe(LIMITS.polarMin)
    expect(high.distance).toBe(LIMITS.zoomOut * R)
    expect(cameraPosition(low, [0, 0.7, 0])[1]).toBeGreaterThan(0.7)
  })

  it('puts the camera in front for azimuth 0 and on the right for a quarter turn', () => {
    const front = cameraPosition({ azimuth: 0, polar: Math.PI / 2, distance: 5 }, [0, 1, 0])
    expect(front[0]).toBeCloseTo(5)
    expect(front[1]).toBeCloseTo(1)
    expect(front[2]).toBeCloseTo(0)
    const right = cameraPosition({ azimuth: Math.PI / 2, polar: Math.PI / 2, distance: 5 }, [0, 1, 0])
    expect(right[2]).toBeCloseTo(5)
  })

  it('opens on the front left three-quarter view', () => {
    const [x, y, z] = cameraPosition(viewOrbit('front', R), [0, 0.7, 0])
    expect(x).toBeGreaterThan(0) // in front
    expect(z).toBeLessThan(0) // on the left
    expect(y).toBeGreaterThan(0.7) // from above
  })

  it('has every fixed view inside the limits', () => {
    for (const v of VIEWS) expect(clampOrbit(viewOrbit(v.id, R), R)).toEqual(viewOrbit(v.id, R))
    expect(cameraPosition(viewOrbit('rear', R), [0, 0, 0])[0]).toBeLessThan(0)
    expect(viewOrbit('top', R).polar).toBe(LIMITS.polarMin)
  })

  it('turns with a drag and wraps the angle', () => {
    const o = viewOrbit('front', R)
    expect(dragOrbit(o, 100, 0, R).azimuth).toBeGreaterThan(o.azimuth)
    expect(dragOrbit(o, 0, 50, R).polar).toBeLessThan(o.polar) // dragging down looks from higher up
    expect(wrap(3 * Math.PI)).toBeCloseTo(Math.PI)
    expect(wrap(-3.5)).toBeCloseTo(-3.5 + 2 * Math.PI)
    expect(Math.abs(dragOrbit(o, 5000, 0, R).azimuth)).toBeLessThanOrEqual(Math.PI)
  })

  it('zooms within the limits', () => {
    const o = viewOrbit('front', R)
    expect(zoomOrbit(o, 0.8, R).distance).toBeCloseTo(o.distance * 0.8)
    expect(zoomOrbit(o, 0.01, R).distance).toBe(LIMITS.zoomIn * R)
  })

  it('moves between views the short way round', () => {
    const a = { azimuth: 3, polar: 1, distance: 8 }
    const b = { azimuth: -3, polar: 1.2, distance: 9 }
    expect(mixOrbit(a, b, 0)).toEqual(a)
    const end = mixOrbit(a, b, 1)
    expect(end.azimuth).toBeCloseTo(-3)
    expect(end.polar).toBeCloseTo(1.2)
    // half way is near pi (through the back), not near 0 (the long way through the front)
    expect(Math.abs(mixOrbit(a, b, 0.5).azimuth)).toBeGreaterThan(3)
  })

  it('answers the arrow keys and +/-, nothing else', () => {
    const o = viewOrbit('front', R)
    expect(keyOrbit(o, 'ArrowRight', R)!.azimuth).toBeGreaterThan(o.azimuth)
    expect(keyOrbit(o, 'ArrowLeft', R)!.azimuth).toBeLessThan(o.azimuth)
    expect(keyOrbit(o, 'ArrowUp', R)!.polar).toBeLessThan(o.polar)
    expect(keyOrbit(o, '+', R)!.distance).toBeLessThan(o.distance)
    expect(keyOrbit(o, '-', R)!.distance).toBeGreaterThan(o.distance)
    expect(keyOrbit(o, 'a', R)).toBeNull()
    expect(keyOrbit(o, 'Tab', R)).toBeNull()
  })
})
