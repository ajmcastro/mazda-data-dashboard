import { useMemo } from 'react'
import type { Body } from './geometry'
import { profile, sharedBox } from './profile'

/**
 * A small flat side view of a car in its own shape (PLAN.md M60): no WebGL, so it works everywhere and several
 * can be on one page. With `scaleWith`, every car of the list is drawn at the same scale (the caller passes the
 * same list to each). Schematic, like the 3D view: the outline, the glass and the wheels.
 */
export default function CarProfile({ body, scaleWith, label }: { body?: Partial<Body>; scaleWith?: (Partial<Body> | undefined)[]; label: string }) {
  const p = useMemo(() => profile(body), [body])
  const box = useMemo(() => sharedBox((scaleWith ?? [body]).map((b) => profile(b))), [scaleWith, body])
  const pad = 0.08
  return (
    <svg
      className="car-profile"
      viewBox={`${-pad} ${-pad - (box.height - p.height)} ${box.length + 2 * pad} ${box.height + 2 * pad}`}
      preserveAspectRatio="xMinYMax meet"
      role="img"
      aria-label={label}
    >
      <line x1={-pad} x2={box.length + pad} y1={p.height} y2={p.height} className="car-profile-ground" />
      <path d={p.lower} className="car-profile-body" />
      <path d={p.cabin} className="car-profile-glass" />
      {p.wheels.map((w) => (
        <g key={w.cx}>
          <circle cx={w.cx} cy={w.cy} r={w.r} className="car-profile-tire" />
          <circle cx={w.cx} cy={w.cy} r={w.r * 0.55} className="car-profile-rim" />
        </g>
      ))}
    </svg>
  )
}
