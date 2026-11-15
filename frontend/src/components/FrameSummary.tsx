import { useMemo, useState } from 'react'
import { useFrameSummary } from '../api/hooks'
import { bodyOfModel } from '../car3d/shapes/common'
import { useCurrentModel } from '../model'
import { Car3DBox } from './Car3DBox'
import type { DtcFrequency } from '../api/types'
import { POSITION_TEXT, baselineRange, cautionNote, faultRange, frameCar, hintLine } from '../frames'
import { Badge, Panel, QueryState } from './ui'

/** How this fault's freeze frames compare with all the other faults' frames (PLAN.md M36): a hint, not a cause. */
export function FrameSummary({ fault }: { fault: DtcFrequency }) {
  const summary = useFrameSummary(fault.ecu, fault.dtc_code)
  const s = summary.data
  const hint = s ? hintLine(s) : null
  // "Show on the car" (M58): the same figures on the 3D car, a part marked only where the summary marks one
  const [onCar, setOnCar] = useState(false)
  const modelBody = useCurrentModel().model?.body
  const body = useMemo(() => bodyOfModel(modelBody), [modelBody])
  const car = useMemo(() => frameCar(s), [s])
  // nothing to compare for a fault without frames: say so quietly instead of an empty panel
  if (s && s.signals.length === 0) return null
  return (
    <Panel title="In the freeze frames" hint={s ? `${s.frames} frame${s.frames === 1 ? '' : 's'} of this fault` : undefined}>
      <QueryState query={summary}>
        {s && (
          <>
            {hint && <p style={{ margin: '0 0 10px' }}>{hint}</p>}
            <div className="table-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th className="num">This fault</th>
                    <th className="num">Other faults’ frames</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.signals.map((x) => (
                    <tr key={x.signal}>
                      <td>{x.label}</td>
                      <td className="num">{faultRange(x)}</td>
                      <td className="num">{baselineRange(x)}</td>
                      <td>{x.position && <Badge kind="dim">{POSITION_TEXT[x.position]}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>{cautionNote(s)}</p>
            {car.hasData && (
              <div style={{ marginTop: 10 }}>
                <button type="button" aria-expanded={onCar} onClick={() => setOnCar(!onCar)}>{onCar ? 'Hide the car' : 'Show on the car'}</button>
                {onCar && (
                  <>
                    <Car3DBox car={car} body={body} fallback={<p className="muted note">The 3D view is not available here; the table above has the same figures.</p>} />
                    <p className="muted note">
                      What this fault's freeze frames recorded, on the parts they are about. “Battery” is drawn at the hood: the drawing does not say where the battery
                      sits. A part is marked only where the table marks a signal; the rest is shown, not judged.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </QueryState>
    </Panel>
  )
}
