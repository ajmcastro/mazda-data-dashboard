/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CarState, Part, PartId } from '../car'
import { LABEL, PIN_RADIUS, columnCapacity, labelText, labelledParts, layoutLabels, layoutPins, type Point, type Side } from './labels'

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
    // last, so the pins already numbered keep their numbers
    expect(labelledParts(car, 'door_driver').map((p) => p.id)).toEqual(['wheel_fl', 'trunk', 'hood', 'fuel', 'door_driver'])
    expect(labelledParts(car, 'trunk').map((p) => p.id)).toEqual(['wheel_fl', 'trunk', 'hood', 'fuel'])
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

describe('layoutPins', () => {
  const PHONE = { width: 340, height: 260 }
  const apart = (pins: { x: number; y: number }[]) => {
    let least = Infinity
    for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
      least = Math.min(least, Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y))
    }
    return least
  }

  it('numbers the pins in the order given and leaves a free pin on its part', () => {
    const pins = layoutPins([pt('wheel_fl', 60, 200), pt('fuel', 250, 120, false)], PHONE)
    expect(pins).toEqual([
      { id: 'wheel_fl', n: 1, x: 60, y: 200, facing: true },
      { id: 'fuel', n: 2, x: 250, y: 120, facing: false },
    ])
  })

  it('moves pins apart that would cover each other', () => {
    const pins = layoutPins([pt('engine', 100, 100), pt('hood', 104, 102), pt('dash', 100, 100)], PHONE)
    expect(apart(pins)).toBeGreaterThanOrEqual(2 * PIN_RADIUS)
    // and not far: each stays near its part
    for (const p of pins) expect(Math.hypot(p.x - 100, p.y - 100)).toBeLessThan(4 * PIN_RADIUS)
  })

  it('keeps every pin inside the view', () => {
    const pins = layoutPins([pt('trunk', -30, 400), pt('hood', 500, -10), pt('fuel', 339, 259), pt('dash', 338, 258)], PHONE)
    for (const p of pins) {
      expect(p.x).toBeGreaterThanOrEqual(PIN_RADIUS)
      expect(p.x).toBeLessThanOrEqual(PHONE.width - PIN_RADIUS)
      expect(p.y).toBeGreaterThanOrEqual(PIN_RADIUS)
      expect(p.y).toBeLessThanOrEqual(PHONE.height - PIN_RADIUS)
    }
  })

  it('separates nine pins crowded in the middle of a phone screen', () => {
    const ids: PartId[] = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'trunk', 'hood', 'fuel', 'engine', 'dash']
    const pins = layoutPins(ids.map((id, i) => pt(id, 160 + (i % 3) * 6, 120 + Math.floor(i / 3) * 6)), PHONE)
    expect(apart(pins)).toBeGreaterThanOrEqual(2 * PIN_RADIUS - 1)
  })

  it('gives the same pins every time', () => {
    const points = [pt('engine', 100, 100), pt('hood', 100, 100), pt('fuel', 110, 100)]
    expect(layoutPins(points, PHONE)).toEqual(layoutPins(points, PHONE))
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
