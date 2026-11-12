import { useFrameSummary } from '../api/hooks'
import type { DtcFrequency } from '../api/types'
import { POSITION_TEXT, baselineRange, cautionNote, faultRange, hintLine } from '../frames'
import { Badge, Panel, QueryState } from './ui'

/** How this fault's freeze frames compare with all the other faults' frames (PLAN.md M36): a hint, not a cause. */
export function FrameSummary({ fault }: { fault: DtcFrequency }) {
  const summary = useFrameSummary(fault.ecu, fault.dtc_code)
  const s = summary.data
  // nothing to compare for a fault without frames: say so quietly instead of an empty panel
  if (s && s.signals.length === 0) return null
  const hint = s ? hintLine(s) : null
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
          </>
        )}
      </QueryState>
    </Panel>
  )
}
