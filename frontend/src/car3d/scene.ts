// The three.js scene of the car (PLAN.md M39). Everything it draws comes from `geometry.ts` (the shape) and
// `car.ts` (what each part reports); this file only makes meshes, colours them and renders on request.
// It never runs a render loop: `render()` is called when something changed, so an idle page draws nothing.
// Every colour of the car is read from the page's CSS variables, so both themes work (only the lights are white).

import {
  BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, EdgesGeometry,
  ExtrudeGeometry, Float32BufferAttribute, Group, HemisphereLight, LineBasicMaterial, LineDashedMaterial, LineSegments,
  Material, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, Raycaster, Scene, Shape,
  ShapeUtils, Vector2, Vector3, WebGLRenderer,
} from 'three'
import type { CarState, PartId, PartState } from '../car'
import { OPEN_ANGLE, cabinHalfWidthAt, facesCamera, halfWidthAt, planShiftAt, type CarGeometry, type Vec2, type Vec3 } from './geometry'
import type { Point } from './labels'
import { cameraPosition, type Orbit } from './orbit'

type Kind = 'wheel' | 'door' | 'hood' | 'trunk'

interface PartObject {
  kind: Kind
  group: Group
  mesh: Mesh<BufferGeometry, MeshLambertMaterial>
  edges: LineSegments
  /** Sign of the swing for a door (which way is outward), or the closed angle for the hood. */
  side: number
  rest: number
}

interface Palette {
  body: Color
  panel: Color
  glass: Color
  tire: Color
  hub: Color
  ground: Color
  line: Color
  strong: Color
  muted: Color
  attention: Color
  open: Color
}

/** Vertical angle of view (degrees) on a wide view. */
const FOV = 30

const BEHIND_LINES = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const

/** The colour of everything that is not a part with a state: neutral tones only, never red or amber. */
const ROLE_COLOUR: Record<Role, (p: Palette) => Color> = {
  body: (p) => p.body, glass: (p) => p.glass, hub: (p) => p.hub, ground: (p) => p.ground,
  trim: (p) => p.tire, lamp: (p) => p.hub, panel: (p) => p.panel,
}

const mix = (a: Color, b: Color, t: number) => a.clone().lerp(b, t)

const luma = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el)
  const v = (name: string) => new Color().setStyle(css.getPropertyValue(name).trim() || 'gray')
  const bg = v('--bg')
  const panel2 = v('--panel-2')
  const muted = v('--muted')
  const text = v('--text')
  return {
    body: mix(panel2, muted, 0.42),
    panel: mix(panel2, muted, 0.58),
    glass: mix(v('--steel'), bg, 0.45),
    // tires are dark in both themes: the darker of the page's background and text colours
    tire: mix(luma(bg) < luma(text) ? bg : text, muted, 0.22),
    hub: mix(muted, text, 0.25),
    ground: mix(v('--panel'), muted, 0.08),
    line: mix(muted, text, 0.35),
    strong: text,
    muted,
    attention: v('--accent'),
    open: v('--amber'),
  }
}

function outline(points: readonly Vec2[], width: number, bevel: number): ExtrudeGeometry {
  const shape = new Shape(points.map(([x, y]) => new Vector2(x, y)))
  const depth = width - 2 * bevel
  const g = new ExtrudeGeometry(shape, {
    depth, steps: 1, curveSegments: 1, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/** Where the cross-section of a lofted piece has its points: close together at the edges, so they can be rounded. */
const ACROSS = [-1, -0.94, -0.8, -0.4, 0, 0.4, 0.8, 0.94, 1]

interface LoftOptions {
  /** Half the piece's width at a point of its outline. */
  halfWidth: (x: number, y: number) => number
  /** How far its edges sit back from its middle, along the car (the rounding seen from above). */
  shift: (x: number) => number
  /** How far the long edges are rounded off. */
  fillet: number
}

/**
 * A piece of the body with a shape across the car too (M43): the side outline, as `outline()` extrudes it, but
 * with a width that changes along the car, edges that are rounded, and a nose and tail that curve in plan.
 * One vertex ring per outline point; the two side faces are the outline triangulated.
 */
function loft(points: readonly Vec2[], o: LoftOptions): BufferGeometry {
  let contour = points.map(([x, y]) => new Vector2(x, y))
  if (ShapeUtils.isClockWise(contour)) contour = contour.reverse()
  const n = contour.length
  const cols = ACROSS.length
  const position: number[] = []
  for (let i = 0; i < n; i++) {
    const p = contour[i]
    const before = contour[(i + n - 1) % n]
    const after = contour[(i + 1) % n]
    // outward direction at this corner of a counter-clockwise outline
    const normal = new Vector2(after.y - before.y, before.x - after.x).normalize()
    const half = o.halfWidth(p.x, p.y)
    const shift = o.shift(p.x)
    for (const t of ACROSS) {
      const edge = Math.max(0, (Math.abs(t) - 0.8) / 0.2) // 0 over the middle, 1 at the very edge
      const pull = o.fillet * edge * edge
      position.push(p.x - normal.x * pull - shift * t * t, p.y - normal.y * pull, t * half)
    }
  }
  const index: number[] = []
  for (let i = 0; i < n; i++) {
    const a = i * cols
    const b = ((i + 1) % n) * cols
    for (let j = 0; j < cols - 1; j++) index.push(a + j, b + j, b + j + 1, a + j, b + j + 1, a + j + 1)
  }
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
    index.push(a * cols + cols - 1, b * cols + cols - 1, c * cols + cols - 1) // the right side faces +z
    index.push(c * cols, b * cols, a * cols) // the left side, turned round
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(position, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/** A flat patch on each side of the cabin (a pillar): the outline at the cabin's own width there. */
function sidePatches(points: readonly Vec2[], halfWidth: (x: number, y: number) => number, shift: (x: number) => number): BufferGeometry {
  let contour = points.map(([x, y]) => new Vector2(x, y))
  if (ShapeUtils.isClockWise(contour)) contour = contour.reverse()
  const n = contour.length
  const position: number[] = []
  for (const side of [1, -1]) for (const p of contour) position.push(p.x - shift(p.x), p.y, side * (halfWidth(p.x, p.y) + 0.004))
  const index: number[] = []
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) index.push(a, b, c, n + c, n + b, n + a)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(position, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

type Role = 'body' | 'glass' | 'hub' | 'ground' | 'trim' | 'lamp' | 'panel'

export class CarScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(FOV, 2, 0.1, 100)
  private parts = new Map<PartId, PartObject>()
  private fixed: { mesh: Mesh; role: Role }[] = []
  private bodyEdges: LineSegments[] = []
  private solid = new LineBasicMaterial()
  private strong = new LineBasicMaterial()
  private dashed = new LineDashedMaterial({ dashSize: 0.06, gapSize: 0.05 })
  private palette: Palette
  private car: CarState | null = null
  private selected: PartId | null = null
  private width = 1
  private height = 1
  private cameraAt: Vec3 = [0, 0, 0]
  private raycaster = new Raycaster()
  private canvas: HTMLCanvasElement
  private geometry: CarGeometry

  /** Throws when the browser cannot give a WebGL context. `onLost` is called if the context is taken away later. */
  constructor(canvas: HTMLCanvasElement, geometry: CarGeometry, onLost: () => void) {
    this.canvas = canvas
    this.geometry = geometry
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      onLost()
    })
    this.palette = readPalette(canvas)
    this.build()
    this.recolor()
  }

  // ---- building ----

  private edgesOf(g: BufferGeometry, angle = 28): LineSegments {
    const lines = new LineSegments(new EdgesGeometry(g, angle), this.solid)
    lines.computeLineDistances() // needed when a part switches to the dashed material
    return lines
  }

  private addFixed(g: BufferGeometry, role: Exclude<Role, 'ground'>, parent: Object3D = this.scene, edges = true): Mesh {
    // the faces are pushed back a little so the outline drawn on their edges is not half hidden by them
    const material = new MeshLambertMaterial({ ...BEHIND_LINES, side: DoubleSide, ...(role === 'glass' ? { transparent: true, opacity: 0.55 } : {}) })
    const mesh = new Mesh(g, material)
    parent.add(mesh)
    this.fixed.push({ mesh, role })
    if (edges) {
      const lines = this.edgesOf(g)
      parent.add(lines)
      this.bodyEdges.push(lines)
    }
    return mesh
  }

  private addPart(id: PartId, kind: Kind, group: Group, g: BufferGeometry, place: (o: Object3D) => void, side = 1, rest = 0) {
    const mesh = new Mesh(g, new MeshLambertMaterial({ ...BEHIND_LINES, side: DoubleSide }))
    mesh.userData.part = id
    const edges = this.edgesOf(g)
    place(mesh)
    place(edges)
    group.add(mesh, edges)
    this.scene.add(group)
    this.parts.set(id, { kind, group, mesh, edges, side, rest })
  }

  private build() {
    const geo = this.geometry
    const { width: W } = geo.body

    // a shape with a style is lofted (it narrows, leans and is rounded); without one it is a plain slab
    const style = geo.style
    const shift = (x: number) => planShiftAt(geo, x)
    const bodyLoft: LoftOptions = { halfWidth: (x) => halfWidthAt(geo, x), shift, fillet: style?.fillet ?? 0 }
    const cabinLoft: LoftOptions = { halfWidth: (x, y) => cabinHalfWidthAt(geo, x, y), shift, fillet: style?.fillet ?? 0 }
    /** A thin piece lying on the body (hood, tailgate, roof): the skin's width there, a touch narrower. */
    const skin = (scale: number): LoftOptions => ({
      halfWidth: (x, y) => scale * (style && y > style.beltY ? cabinHalfWidthAt(geo, x, y) : halfWidthAt(geo, x)),
      shift, fillet: 0.012,
    })
    if (style) {
      this.addFixed(loft(geo.lower, bodyLoft), 'body')
      this.addFixed(loft(geo.cabin, cabinLoft), 'glass')
      this.addFixed(loft(style.roof, skin(1.01)), 'panel')
      for (const pillar of style.pillars) this.addFixed(sidePatches(pillar, cabinLoft.halfWidth, shift), 'panel')
      for (const d of style.details) {
        const block = this.addFixed(new BoxGeometry(...d.size), d.tone)
        block.position.set(...d.centre)
        this.bodyEdges.at(-1)!.position.set(...d.centre)
      }
    } else {
      this.addFixed(outline(geo.lower, W, 0.03), 'body')
      this.addFixed(outline(geo.cabin, geo.cabinWidth, 0.03), 'glass')
    }

    const ground = new Mesh(new CircleGeometry(geo.radius * 1.25, 72), new MeshBasicMaterial({ transparent: true, opacity: 0.55 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.002
    this.scene.add(ground)
    this.fixed.push({ mesh: ground, role: 'ground' })

    for (const w of geo.wheels) {
      const group = new Group()
      group.position.set(...w.centre)
      const tire = new CylinderGeometry(w.radius, w.radius, w.width, 32)
      const turn = (o: Object3D) => void (o.rotation.x = Math.PI / 2)
      this.addPart(w.id, 'wheel', group, tire, turn)
      const hub = this.addFixed(new CylinderGeometry(w.radius * 0.6, w.radius * 0.6, w.width + 0.012, 24), 'hub', group)
      hub.rotation.x = Math.PI / 2
      hub.userData.part = w.id // a click on the hub is a click on the wheel
      this.bodyEdges.at(-1)!.rotation.x = Math.PI / 2
      for (let k = 0; k < (style?.spokes ?? 0); k++) {
        // a dark wheel with light spokes instead of a plain disc
        if (k === 0) {
          this.fixed.at(-1)!.role = 'trim'
          hub.scale.set(1.25, 1, 1.25)
        }
        const angle = (2 * Math.PI * k) / style!.spokes + Math.PI / 2
        const reach = w.radius * 0.7
        const spoke = this.addFixed(new BoxGeometry(reach, w.radius * 0.17, w.width + 0.03), 'lamp', group, false)
        spoke.position.set((Math.cos(angle) * reach) / 2, (Math.sin(angle) * reach) / 2, 0)
        spoke.rotation.z = angle
        spoke.userData.part = w.id
      }
    }

    for (const d of geo.doors) {
      const group = new Group()
      group.position.set(d.x0, 0, d.z) // the hinge: the door's front edge
      const panel = outline(d.outline.map(([x, y]): Vec2 => [x - d.x0, y]), 0.03, 0.004)
      this.addPart(d.id, 'door', group, panel, () => {}, d.side)
    }

    {
      // a strip along the hood's line, standing a little proud of the body; it turns about its rear end
      const { hinge, line, width } = geo.hood
      const rel = line.map(([x, y]): Vec2 => [x - hinge[0], y - hinge[1]])
      const strip: Vec2[] = [...rel, ...[...rel].reverse().map(([x, y]): Vec2 => [x, y + 0.028])]
      const group = new Group()
      group.position.set(hinge[0], hinge[1], 0)
      const at = (g: BufferGeometry) => g.translate(-hinge[0], -hinge[1], 0)
      const absolute = strip.map(([x, y]): Vec2 => [x + hinge[0], y + hinge[1]])
      this.addPart('hood', 'hood', group, style ? at(loft(absolute, skin(0.93))) : outline(strip, width, 0.004), () => {})
    }

    {
      // the same for the tailgate, down the back of the car from its hinge on the roof
      const { hinge, line, width } = geo.trunk
      const t = 0.035
      const rel = line.map(([x, y]): Vec2 => [x - hinge[0], y - hinge[1]])
      const outer = [...rel].reverse().map(([x, y], i, all): Vec2 => (i === all.length - 1 ? [-t * 0.6, t * 0.6] : [x - t, y + 0.01]))
      const group = new Group()
      group.position.set(hinge[0], hinge[1], 0)
      const absolute = [...rel, ...outer].map(([x, y]): Vec2 => [x + hinge[0], y + hinge[1]])
      const piece = style ? loft(absolute, skin(0.95)).translate(-hinge[0], -hinge[1], 0) : outline([...rel, ...outer], width, 0.008)
      this.addPart('trunk', 'trunk', group, piece, () => {})
    }

    this.scene.add(new HemisphereLight(0xffffff, 0x888888, 2.1))
    const sun = new DirectionalLight(0xffffff, 1.6)
    sun.position.set(4, 8, -5)
    this.scene.add(sun)
  }

  // ---- state ----

  /** What the car reports, and which part is picked out. Call `render()` afterwards. */
  setCar(car: CarState, selected: PartId | null) {
    this.car = car
    this.selected = selected
    this.apply()
  }

  /** Re-reads the page's colours (after a theme change). */
  recolor() {
    const p = (this.palette = readPalette(this.canvas))
    this.solid.color.copy(p.line)
    this.strong.color.copy(p.strong)
    this.dashed.color.copy(p.muted)
    for (const { mesh, role } of this.fixed) {
      const material = mesh.material as MeshLambertMaterial | MeshBasicMaterial
      material.color.copy(ROLE_COLOUR[role](p))
    }
    this.apply()
  }

  private apply() {
    const p = this.palette
    const states = new Map<PartId, PartState>((this.car?.parts ?? []).map((part) => [part.id, part.state]))
    for (const [id, o] of this.parts) {
      const state = states.get(id) ?? 'absent'
      const base = o.kind === 'wheel' ? p.tire : p.panel
      const material = o.mesh.material
      material.color.copy(state === 'attention' ? p.attention : state === 'open' ? p.open : base)
      material.transparent = state === 'unknown'
      material.opacity = state === 'unknown' ? 0.22 : 1
      material.depthWrite = state !== 'unknown'
      material.needsUpdate = true
      o.edges.material = id === this.selected ? this.strong : state === 'unknown' ? this.dashed : this.solid
      const open = state === 'open'
      if (o.kind === 'door') o.group.rotation.y = open ? o.side * OPEN_ANGLE.door : 0
      else if (o.kind === 'hood') o.group.rotation.z = o.rest + (open ? OPEN_ANGLE.hood : 0)
      else if (o.kind === 'trunk') o.group.rotation.z = open ? -OPEN_ANGLE.trunk : 0
    }
  }

  // ---- camera, size, drawing ----

  setOrbit(orbit: Orbit) {
    const target = this.geometry.centre
    this.cameraAt = cameraPosition(orbit, target)
    this.camera.position.set(...this.cameraAt)
    this.camera.lookAt(target[0], target[1], target[2])
    this.camera.updateMatrixWorld()
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    // on a view narrower than 3:2 the angle opens up so the car's length still fits across (a phone in portrait)
    const half = Math.tan((FOV / 2) * (Math.PI / 180)) * Math.max(1, 1.5 / this.camera.aspect)
    this.camera.fov = 2 * Math.atan(half) * (180 / Math.PI)
    this.camera.updateProjectionMatrix()
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  /** Where the given parts are on screen (pixels), and whether each is turned towards the camera. */
  project(ids: readonly PartId[]): Point[] {
    const v = new Vector3()
    return ids.map((id) => {
      const anchor = this.geometry.anchors[id]
      v.set(...anchor.pos).project(this.camera)
      return { id, x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, facing: facesCamera(anchor, this.cameraAt) }
    })
  }

  /** The part under a point of the canvas (pixels), or null: the body hides what is behind it. */
  pick(x: number, y: number): PartId | null {
    this.raycaster.setFromCamera(new Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2), this.camera)
    const targets = [...[...this.parts.values()].map((o) => o.mesh), ...this.fixed.filter((f) => f.role !== 'ground').map((f) => f.mesh)]
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    return (hit?.object.userData.part as PartId | undefined) ?? null
  }

  /** Frees the GPU memory. The scene cannot be used afterwards. */
  dispose() {
    this.scene.traverse((o) => {
      const mesh = o as Partial<Mesh>
      mesh.geometry?.dispose()
      const material = mesh.material as Material | Material[] | undefined
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose()
    })
    this.solid.dispose()
    this.strong.dispose()
    this.dashed.dispose()
    this.renderer.dispose()
  }
}

/** Whether this browser can draw the scene at all (asked before the canvas is shown). */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}
