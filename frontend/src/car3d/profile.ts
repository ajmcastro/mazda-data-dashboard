// A car's side view as flat shapes (PLAN.md M60): the same outline the 3D view extrudes, for a small drawing on
// pages that do not need (or cannot have) the 3D scene. Pure numbers, no three.js. Front of the car to the LEFT.

import { carGeometry, type Body, type CarGeometry, type Vec2 } from './geometry'

export interface Profile {
  /** metres: the car's length and height, wheels included */
  length: number
  height: number
  /** closed outlines as SVG path data, in metres, the ground at y = height and the nose at x = 0 */
  lower: string
  cabin: string
  /** the two wheels on the side facing the viewer */
  wheels: { cx: number; cy: number; r: number }[]
}

const round = (v: number) => Math.round(v * 1000) / 1000

/** The side view of a geometry. In the geometry the front is at +x and up is +y; here the nose is at 0 and y grows down. */
export function profileOf(g: CarGeometry): Profile {
  const xs = [...g.lower, ...g.cabin].map((p) => p[0])
  const ys = [...g.lower, ...g.cabin].map((p) => p[1])
  const front = Math.max(...xs)
  const top = Math.max(...ys)
  const length = front - Math.min(...xs)
  const px = (p: Vec2) => `${round(front - p[0])} ${round(top - p[1])}`
  const path = (points: readonly Vec2[]) => (points.length ? `M ${points.map(px).join(' L ')} Z` : '')
  const seen = new Set<string>()
  const wheels = g.wheels
    .filter((w) => {
      const key = round(w.centre[0]).toString() // one per axle: the two sides overlap in a side view
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((w) => ({ cx: round(front - w.centre[0]), cy: round(top - w.centre[1]), r: round(w.radius) }))
    .sort((a, b) => a.cx - b.cx)
  return { length: round(length), height: round(top), lower: path(g.lower), cabin: path(g.cabin), wheels }
}

export const profile = (body?: Partial<Body>): Profile => profileOf(carGeometry(body))

/**
 * The box (in metres) to draw several cars in at ONE scale: as long as the longest and as high as the highest,
 * so a shorter car is drawn shorter. Each car stands on the same ground line, nose at the left.
 */
export function sharedBox(profiles: readonly Profile[]): { length: number; height: number } {
  return {
    length: Math.max(0, ...profiles.map((p) => p.length)),
    height: Math.max(0, ...profiles.map((p) => p.height)),
  }
}
