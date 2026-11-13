/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CarState, Part, PartId } from '../car'
import { LABEL, columnCapacity, labelText, labelledParts, layoutLabels, type Point, type Side } from './labels'

const VIEW = { width: 800, height: 400 }
const pt = (id: PartId, x: number, y: number, facing = true): Point => ({ id, x, y, facing })

describe('layoutLabels', () => {
  it('puts each label in the column on its part\'s side, at its height', () => {
    const [a, b] = layoutLabels([pt('wheel_fl', 250, 300), pt('wheel_fr', 560, 120)], VIEW)
    expect(a).toMatchObject({ id: 'wheel_fl', side: 'left', left: LABEL.gap, top: 300 - LABEL.height / 2 })
    expect(b).toMatchObject({ id: 'wheel_fr', side: 'right', left: VIEW.width - LABEL.gap - LABEL.width })
    // the leader runs from the label's inner edge to the part
    expect(a.from).toEqual({ x: LABEL.gap + LABEL.width, y: 300 })
    expect(a.to).toEqual({ x: 250, y: 300 })
    expect(b.from.x).toBe(VIEW.width - LABEL.gap - LABEL.width)
  })

  it('never overlaps two labels of a column', () => {
    const points = (['wheel_fl', 'wheel_rl', 'door_driver', 'fuel', 'engine', 'dash'] as PartId[]).map((id, i) => pt(id, 200, 200 + i))
    const placed = layoutLabels(points, VIEW).sort((a, b) => a.top - b.top)
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].top - placed[i - 1].top).toBeGreaterThanOrEqual(LABEL.height + LABEL.gap)
    }
    expect(placed[0].top).toBeGreaterThanOrEqual(LABEL.gap)
    expect(placed.at(-1)!.top + LABEL.height).toBeLessThanOrEqual(VIEW.height - LABEL.gap)
  })

  it('keeps labels inside the view when the parts are at its edge', () => {
    const top = layoutLabels([pt('hood', 100, -50), pt('dash', 100, -40)], VIEW)
    expect(Math.min(...top.map((p) => p.top))).toBe(LABEL.gap)
    const bottom = layoutLabels([pt('wheel_fl', 100, 900), pt('wheel_rl', 100, 950)], VIEW)
    expect(Math.max(...bottom.map((p) => p.top + LABEL.height))).toBe(VIEW.height - LABEL.gap)
  })

  it('does not depend on the order of the input', () => {
    const points = [pt('wheel_fl', 200, 100), pt('fuel', 200, 100), pt('engine', 600, 90), pt('dash', 210, 300)]
    const key = (ps: Point[]) => layoutLabels(ps, VIEW).sort((a, b) => a.id.localeCompare(b.id))
    expect(key([...points].reverse())).toEqual(key(points))
  })

  it('keeps a label on its side while its part is near the middle', () => {
    const before = new Map<PartId, Side>([['fuel', 'left']])
    // just right of the middle: stays left
    expect(layoutLabels([pt('fuel', 430, 200)], VIEW, before)[0].side).toBe('left')
    // clearly on the right: moves
    expect(layoutLabels([pt('fuel', 560, 200)], VIEW, before)[0].side).toBe('right')
    // without a history the middle decides
    expect(layoutLabels([pt('fuel', 430, 200)], VIEW)[0].side).toBe('right')
  })

  it('passes on whether the part faces the camera', () => {
    expect(layoutLabels([pt('wheel_fr', 500, 200, false)], VIEW)[0].facing).toBe(false)
  })

  it('knows how many labels a column holds', () => {
    expect(columnCapacity(400)).toBe(8)
    expect(columnCapacity(10)).toBe(0)
  })
})

describe('labelledParts', () => {
  const part = (id: PartId, group: Part['group'], state: Part['state']): Part => ({
    id, group, state, name: id === 'wheel_fl' ? 'Front left wheel' : 'Driver door', value: '', notes: [], at: null, old: false,
  })
  const car: CarState = {
    hasData: true, asOf: null,
    parts: [
      part('wheel_fl', 'wheels', 'ok'), part('wheel_fr', 'wheels', 'absent'),
      part('door_driver', 'doors', 'ok'), part('trunk', 'doors', 'unknown'), part('hood', 'doors', 'open'),
      part('fuel', 'other', 'ok'), part('engine', 'other', 'absent'),
    ],
  }
  it('labels wheels and figures always, a door only when it is not simply closed', () => {
    expect(labelledParts(car, null).map((p) => p.id)).toEqual(['wheel_fl', 'trunk', 'hood', 'fuel'])
  })
  it('labels a closed door once it is selected', () => {
    expect(labelledParts(car, 'door_driver').map((p) => p.id)).toContain('door_driver')
  })
  it('never labels what the car does not send, even when selected', () => {
    expect(labelledParts(car, 'engine').map((p) => p.id)).not.toContain('engine')
  })
  it('shortens a wheel\'s name and the oil countdown', () => {
    expect(labelText(car.parts[0]).name).toBe('Front left')
    expect(labelText(car.parts[2]).name).toBe('Driver door')
    const engine = { ...car.parts[6], value: '6,000 km to oil change' }
    expect(labelText(engine)).toEqual({ name: 'Oil change in', value: '6,000 km' })
    expect(labelText({ ...engine, value: 'oil level flag clear' })).toEqual({ name: 'Oil level flag', value: 'clear' })
    expect(labelText({ ...engine, value: 'not sent' })).toEqual({ name: 'Driver door', value: 'not sent' })
  })
})

// three.js is big: it must stay in the chunk that is loaded with the 3D view, never in the first one.
describe('the 3D code stays out of the first chunk', () => {
  const src = fileURLToPath(new URL('..', import.meta.url))
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : []
    })
  const files = walk(src).map((path) => ({ rel: relative(src, path), text: readFileSync(path, 'utf8') }))
  const HEAVY = ['car3d/scene.ts', 'car3d/Car3D.tsx']

  it('only the scene files import three', () => {
    const importers = files.filter((f) => /from\s+'three(\/[^']*)?'/.test(f.text)).map((f) => f.rel)
    expect(importers.length).toBeGreaterThan(0)
    for (const rel of importers) expect(HEAVY).toContain(rel)
  })

  it('nothing outside car3d/ imports the scene files statically', () => {
    for (const f of files.filter((x) => !x.rel.startsWith('car3d/'))) {
      expect(f.text, f.rel).not.toMatch(/^import\s[^\n]*car3d\/(scene|Car3D)'/m)
    }
    const panel = files.find((f) => f.rel === 'components/CarPanel.tsx')!
    expect(panel.text).toMatch(/lazy\(\(\) => import\('\.\.\/car3d\/Car3D'\)\)/)
  })
})
