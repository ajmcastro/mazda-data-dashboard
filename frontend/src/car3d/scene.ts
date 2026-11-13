// The three.js scene of the car (PLAN.md M39). Everything it draws comes from `geometry.ts` (the shape) and
// `car.ts` (what each part reports); this file only makes meshes, colours them and renders on request.
// It never runs a render loop: `render()` is called when something changed, so an idle page draws nothing.
// Every colour of the car is read from the page's CSS variables, so both themes work (only the lights are white).

import {
  BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight, EdgesGeometry,
  ExtrudeGeometry, Group, HemisphereLight, LineBasicMaterial, LineDashedMaterial, LineSegments, Material, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, Raycaster, Scene, Shape, Vector2, Vector3,
  WebGLRenderer,
} from 'three'
import type { CarState, PartId, PartState } from '../car'
import { OPEN_ANGLE, facesCamera, type CarGeometry, type Vec2, type Vec3 } from './geometry'
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

export class CarScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(FOV, 2, 0.1, 100)
  private parts = new Map<PartId, PartObject>()
  private fixed: { mesh: Mesh; role: 'body' | 'glass' | 'hub' | 'ground' }[] = []
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

  private addFixed(g: BufferGeometry, role: 'body' | 'glass' | 'hub', parent: Object3D = this.scene, edges = true): Mesh {
    // the faces are pushed back a little so the outline drawn on their edges is not half hidden by them
    const material = new MeshLambertMaterial({ ...BEHIND_LINES, ...(role === 'glass' ? { transparent: true, opacity: 0.55 } : {}) })
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
    const mesh = new Mesh(g, new MeshLambertMaterial(BEHIND_LINES))
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

    this.addFixed(outline(geo.lower, W, 0.03), 'body')
    this.addFixed(outline(geo.cabin, geo.cabinWidth, 0.03), 'glass')

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
    }

    for (const d of geo.doors) {
      const length = d.x0 - d.x1
      const group = new Group()
      group.position.set(d.x0, 0, d.z) // the hinge: the door's front edge
      const panel = new BoxGeometry(length, d.y1 - d.y0, 0.03)
      this.addPart(d.id, 'door', group, panel, (o) => o.position.set(-length / 2, (d.y0 + d.y1) / 2, 0), d.side)
    }

    {
      const { hinge, tip, width } = geo.hood
      const length = Math.hypot(tip[0] - hinge[0], tip[1] - hinge[1])
      const rest = Math.atan2(tip[1] - hinge[1], tip[0] - hinge[0])
      const group = new Group()
      group.position.set(hinge[0], hinge[1], 0)
      this.addPart('hood', 'hood', group, new BoxGeometry(length, 0.028, width), (o) => o.position.set(length / 2, 0, 0), 1, rest)
    }

    {
      const { hinge, knee, foot, width } = geo.trunk
      const t = 0.035
      const rel = (p: Vec2): Vec2 => [p[0] - hinge[0], p[1] - hinge[1]]
      const k = rel(knee)
      const f = rel(foot)
      const shape: Vec2[] = [[0, 0], k, f, [f[0] - t, f[1]], [k[0] - t, k[1] + 0.01], [-t * 0.6, t * 0.6]]
      const group = new Group()
      group.position.set(hinge[0], hinge[1], 0)
      this.addPart('trunk', 'trunk', group, outline(shape, width, 0.008), () => {})
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
      material.color.copy(role === 'body' ? p.body : role === 'glass' ? p.glass : role === 'hub' ? p.hub : p.ground)
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
