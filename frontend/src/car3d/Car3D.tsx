import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CarState, PartId } from '../car'
import { stateBadge } from '../car'
import { Badge } from '../components/ui'
import { ANIMATE, fmtDateTime } from '../lib'
import { carGeometry, type Body } from './geometry'
import { LABEL, labelText, labelledParts, layoutLabels, type Placed, type Side } from './labels'
import { VIEWS, dragOrbit, keyOrbit, mixOrbit, viewOrbit, zoomOrbit, type Orbit, type ViewId } from './orbit'
import { CarScene, webglAvailable } from './scene'

const TWEEN_MS = 320
/** A press that moves less than this many pixels is a click on a part, not a drag. */
const CLICK_SLOP = 5

/**
 * The car in 3D (PLAN.md M39): a canvas drawn by `CarScene`, with the labels as ordinary HTML on top of it.
 * It draws `car` (from `car.ts`) and nothing else, so it always agrees with the list. `onFail` is called when
 * the browser cannot draw it (no WebGL, or the context was lost); the panel then shows the list.
 */
export default function Car3D({ car, body, onFail }: { car: CarState; body?: Partial<Body>; onFail: (why: string) => void }) {
  const geometry = useMemo(() => carGeometry(body), [body])
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<CarScene | null>(null)
  const orbitRef = useRef<Orbit>(viewOrbit('front', geometry.radius))
  const sidesRef = useRef(new Map<PartId, Side>())
  const sizeRef = useRef({ width: 0, height: 0 })
  const tweenRef = useRef(0)
  const dragRef = useRef<{ id: number; x: number; y: number; moved: number } | null>(null)
  const [selected, setSelected] = useState<PartId | null>(null)
  const [labels, setLabels] = useState<Placed[]>([])
  const shown = useMemo(() => labelledParts(car, selected), [car, selected])
  const shownRef = useRef(shown)
  const failRef = useRef(onFail)
  // kept in refs so the drawing callbacks always see the newest without being rebuilt (this effect runs first)
  useEffect(() => {
    shownRef.current = shown
    failRef.current = onFail
  })

  /** Draws the scene from the current camera and puts the labels where the parts now are. */
  const refresh = useCallback(() => {
    const scene = sceneRef.current
    const size = sizeRef.current
    if (!scene || size.width === 0) return
    scene.setOrbit(orbitRef.current)
    scene.render()
    const placed = layoutLabels(scene.project(shownRef.current.map((p) => p.id)), size, sidesRef.current)
    sidesRef.current = new Map(placed.map((p) => [p.id, p.side]))
    setLabels(placed)
  }, [])

  const stopTween = () => cancelAnimationFrame(tweenRef.current)

  const moveTo = useCallback(
    (to: Orbit) => {
      stopTween()
      if (!ANIMATE) {
        orbitRef.current = to
        refresh()
        return
      }
      const from = orbitRef.current
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / TWEEN_MS)
        orbitRef.current = mixOrbit(from, to, t)
        refresh()
        if (t < 1) tweenRef.current = requestAnimationFrame(step)
      }
      tweenRef.current = requestAnimationFrame(step)
    },
    [refresh],
  )

  // the scene lives as long as the canvas and the car's shape
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    let scene: CarScene
    try {
      if (!webglAvailable()) throw new Error('no WebGL') // asked first: three.js logs an error when it finds out itself
      scene = new CarScene(canvas, geometry, () => failRef.current('The 3D view was interrupted by the browser.'))
    } catch {
      failRef.current('This browser cannot draw the 3D view (WebGL is not available).')
      return
    }
    sceneRef.current = scene
    orbitRef.current = viewOrbit('front', geometry.radius)

    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect()
      sizeRef.current = { width, height }
      scene.resize(width, height)
      refresh()
    }
    const resize = new ResizeObserver(fit)
    resize.observe(wrap)

    // the colours come from the page: read them again when the theme changes
    const recolor = () => {
      scene.recolor()
      refresh()
    }
    const theme = new MutationObserver(recolor)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const scheme = window.matchMedia('(prefers-color-scheme: light)')
    scheme.addEventListener('change', recolor)

    // zooming with the wheel would trap the page's scrolling, so it needs Ctrl or Cmd (a trackpad pinch sends Ctrl)
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      stopTween()
      orbitRef.current = zoomOrbit(orbitRef.current, Math.exp(e.deltaY * 0.01), geometry.radius)
      refresh()
    }
    canvas.addEventListener('wheel', wheel, { passive: false })

    return () => {
      stopTween()
      resize.disconnect()
      theme.disconnect()
      scheme.removeEventListener('change', recolor)
      canvas.removeEventListener('wheel', wheel)
      sceneRef.current = null
      scene.dispose()
    }
  }, [geometry, refresh])

  useEffect(() => {
    sceneRef.current?.setCar(car, selected)
    refresh()
  }, [car, selected, geometry, refresh])

  const toggle = (id: PartId | null) => setSelected((now) => (id === null || now === id ? null : id))

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    stopTween()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== e.pointerId) return
    const dx = e.clientX - drag.x
    // a finger turns the car sideways only: its up and down movement scrolls the page (touch-action: pan-y)
    const dy = e.pointerType === 'touch' ? 0 : e.clientY - drag.y
    drag.x = e.clientX
    drag.y = e.clientY
    drag.moved += Math.abs(dx) + Math.abs(dy)
    orbitRef.current = dragOrbit(orbitRef.current, dx, dy, geometry.radius)
    refresh()
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.moved > CLICK_SLOP) return
    const box = e.currentTarget.getBoundingClientRect()
    toggle(sceneRef.current?.pick(e.clientX - box.left, e.clientY - box.top) ?? null)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === 'Escape') return setSelected(null)
    if (e.key === 'Home') {
      e.preventDefault()
      return moveTo(viewOrbit('front', geometry.radius))
    }
    const next = keyOrbit(orbitRef.current, e.key, geometry.radius)
    if (!next) return
    e.preventDefault()
    stopTween()
    orbitRef.current = next
    refresh()
  }

  const view = (id: ViewId) => moveTo(viewOrbit(id, geometry.radius))
  const zoom = (factor: number) => moveTo(zoomOrbit(orbitRef.current, factor, geometry.radius))
  const byId = new Map(car.parts.map((p) => [p.id, p]))
  const picked = selected ? byId.get(selected) : undefined
  const pickedBadge = picked ? stateBadge(picked) : null

  return (
    <div className="car3d">
      <div className="car3d-view" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label="The car in 3D. Arrow keys turn it, plus and minus zoom, Home resets the view. The figures are the labels that follow."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (dragRef.current = null)}
          onKeyDown={onKeyDown}
        />
        <svg className="car3d-leaders" aria-hidden="true">
          {labels.map((l) => {
            const part = byId.get(l.id)
            return (
              <g key={l.id} className={`${part?.state ?? ''}${l.facing ? '' : ' far'}${l.id === selected ? ' selected' : ''}`}>
                <line x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} />
                <circle cx={l.to.x} cy={l.to.y} r={3} />
              </g>
            )
          })}
        </svg>
        {labels.map((l) => {
          const part = byId.get(l.id)
          if (!part) return null
          const text = labelText(part)
          return (
            <button
              key={l.id}
              type="button"
              className={`car3d-label ${part.state}${part.old ? ' old' : ''}${l.facing ? '' : ' far'}${l.id === selected ? ' selected' : ''}`}
              style={{ left: l.left, top: l.top, width: LABEL.width, height: LABEL.height }}
              aria-pressed={l.id === selected}
              onClick={() => toggle(l.id)}
            >
              <span className="car3d-label-name">{text.name}</span>
              <span className="car3d-label-value">{text.value}</span>
            </button>
          )
        })}
      </div>

      <div className="car3d-bar">
        <div className="theme-toggle" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => view(v.id)}>{v.label}</button>
          ))}
        </div>
        <div className="theme-toggle" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoom(1 / 0.8)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom in">+</button>
        </div>
        <span className="muted car3d-hint">Drag to turn · Ctrl + scroll to zoom · schematic shape, not the real body</span>
      </div>

      <div className="car3d-detail" aria-live="polite">
        {picked ? (
          <>
            <div className="car-part-head">
              <span className="car-part-name">{picked.name}</span>
              <span className="car-part-value">
                {pickedBadge && <Badge kind={pickedBadge.kind}>{pickedBadge.text}</Badge>} {picked.value}
              </span>
            </div>
            {picked.notes.map((n) => (
              <div key={n} className="car-part-note">{n}</div>
            ))}
            {picked.at && picked.group !== 'wheels' && <div className="car-part-note">reported {fmtDateTime(picked.at)}</div>}
          </>
        ) : (
          <span className="muted">Click a part of the car, or a label, to see its details here.</span>
        )}
      </div>
    </div>
  )
}
