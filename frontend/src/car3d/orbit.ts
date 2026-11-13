// Where the camera is: it circles the car on a sphere (PLAN.md M39). Pure maths, no three.js.
// `azimuth` turns around the vertical axis (0 = straight in front of the car, a quarter turn = its right side),
// `polar` is the angle down from straight above, `distance` is how far away.

import type { Vec3 } from './geometry'

export interface Orbit {
  azimuth: number
  polar: number
  distance: number
}

/** The camera never goes under the ground, never looks exactly down its own axis, never enters the car. */
export const LIMITS = { polarMin: 0.12, polarMax: 1.5, zoomIn: 1.9, zoomOut: 5.2 } as const

const TAU = 2 * Math.PI

/** An angle brought into (-pi, pi]. */
export const wrap = (a: number): number => {
  if (a > -Math.PI && a <= Math.PI) return a
  const w = ((a % TAU) + TAU) % TAU
  return w > Math.PI ? w - TAU : w
}

/** `radius` is the car's bounding radius: the distance limits are multiples of it, so a longer car stays in view. */
export function clampOrbit(o: Orbit, radius: number): Orbit {
  return {
    azimuth: wrap(o.azimuth),
    polar: Math.min(LIMITS.polarMax, Math.max(LIMITS.polarMin, o.polar)),
    distance: Math.min(LIMITS.zoomOut * radius, Math.max(LIMITS.zoomIn * radius, o.distance)),
  }
}

export function cameraPosition(o: Orbit, target: Vec3): Vec3 {
  const s = Math.sin(o.polar)
  return [
    target[0] + o.distance * s * Math.cos(o.azimuth),
    target[1] + o.distance * Math.cos(o.polar),
    target[2] + o.distance * s * Math.sin(o.azimuth),
  ]
}

export type ViewId = 'front' | 'side' | 'rear' | 'top'

export const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'rear', label: 'Rear' },
  { id: 'top', label: 'Top' },
]

/** The fixed views. "Front" is the three-quarter view from the front left the panel opens with. */
export function viewOrbit(id: ViewId, radius: number): Orbit {
  const distance = 3.1 * radius
  switch (id) {
    case 'front': return { azimuth: -0.7, polar: 1.12, distance }
    case 'side': return { azimuth: -Math.PI / 2, polar: 1.38, distance }
    case 'rear': return { azimuth: Math.PI - 0.7, polar: 1.12, distance }
    case 'top': return { azimuth: -Math.PI / 2, polar: LIMITS.polarMin, distance: 3.4 * radius }
  }
}

/** A drag of (dx, dy) pixels: the car follows the pointer. */
export function dragOrbit(o: Orbit, dx: number, dy: number, radius: number): Orbit {
  return clampOrbit({ ...o, azimuth: o.azimuth + dx * 0.008, polar: o.polar - dy * 0.006 }, radius)
}

/** `factor` under 1 comes closer. */
export function zoomOrbit(o: Orbit, factor: number, radius: number): Orbit {
  return clampOrbit({ ...o, distance: o.distance * factor }, radius)
}

/** Part of the way (0..1) from one view to another, turning the short way round. */
export function mixOrbit(a: Orbit, b: Orbit, t: number): Orbit {
  const k = t * t * (3 - 2 * t)
  return {
    azimuth: wrap(a.azimuth + wrap(b.azimuth - a.azimuth) * k),
    polar: a.polar + (b.polar - a.polar) * k,
    distance: a.distance + (b.distance - a.distance) * k,
  }
}

/** What an arrow key or +/- does; null for any other key. */
export function keyOrbit(o: Orbit, key: string, radius: number): Orbit | null {
  switch (key) {
    case 'ArrowLeft': return dragOrbit(o, -20, 0, radius)
    case 'ArrowRight': return dragOrbit(o, 20, 0, radius)
    case 'ArrowUp': return dragOrbit(o, 0, 20, radius)
    case 'ArrowDown': return dragOrbit(o, 0, -20, radius)
    case '+': case '=': return zoomOrbit(o, 0.88, radius)
    case '-': case '_': return zoomOrbit(o, 1 / 0.88, radius)
    default: return null
  }
}
