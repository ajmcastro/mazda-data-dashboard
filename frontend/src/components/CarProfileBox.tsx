import { tr } from '../i18n'
import { lazy, Suspense, useMemo } from 'react'
import type { ModelBody } from '../api/types'
import { bodyOfModel } from '../car3d/shapes/common'

// the outlines of the cars live with the 3D code: loaded when a drawing is shown, never in the first chunk
const CarProfile = lazy(() => import('../car3d/CarProfile'))

/** A car's side view from its model's `body` (PLAN.md M60); several with the same `others` share one scale. */
export function CarProfileBox({ body, others, name }: { body: ModelBody | null | undefined; others?: (ModelBody | null | undefined)[]; name: string }) {
  const own = useMemo(() => bodyOfModel(body), [body])
  const all = useMemo(() => others?.map((b) => bodyOfModel(b)), [others])
  return (
    <div className="car-profile-box">
      <Suspense fallback={null}>
        <CarProfile body={own} scaleWith={all} label={tr('{name}, side view: a schematic drawing, not the real body', { name })} />
      </Suspense>
    </div>
  )
}
