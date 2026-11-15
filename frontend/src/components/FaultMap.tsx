import { tr, trn } from '../i18n'
import type { DtcFrequency } from '../api/types'
import { FAULT_MAP_NOTES, ZONES, faultMap, faultsText } from '../faultmap'
import { useCurrentModel } from '../model'
import { Panel } from './ui'

const [W, H] = [150, 300] // the car from above, front at the top
const BODY = { x: 22, y: 12, w: W - 44, h: H - 24 }

/** The fault map (PLAN.md M59): the units the owner placed, on a plan view of the car, lit by their faults. */
export function FaultMap({ faults, selected, onSelect }: { faults: DtcFrequency[] | undefined; selected: string | null; onSelect: (ecu: string | null) => void }) {
  const { id, model } = useCurrentModel()
  const map = faultMap(model?.layout, faults)
  if (map.units.length === 0 && map.unplaced.length === 0) return null
  const pick = (ecu: string) => onSelect(selected === ecu ? null : ecu)
  return (
    <Panel title={tr('Fault map')} hint={tr('control units where you placed them')}>
      <div className="fault-map">
        {map.units.length > 0 && (
          <svg viewBox={`0 0 ${W} ${H}`} className="fault-map-car" role="group" aria-label={tr('The car from above, front at the top, with the control units you placed')}>
            <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={30} className="seat-map-body" />
            {Object.entries(ZONES).map(([zone, z]) => (
              <line key={zone} x1={BODY.x + 8} x2={BODY.x + BODY.w - 8} y1={BODY.y + z.along * BODY.h} y2={BODY.y + z.along * BODY.h} className="fault-map-zone">
                <title>{z.label}</title>
              </line>
            ))}
            {map.units.map((u) => (
              <g
                key={u.ecu}
                className={`fault-map-unit ${u.state}${selected === u.ecu ? ' selected' : ''}`}
                transform={`translate(${BODY.x + u.across * BODY.w}, ${BODY.y + u.along * BODY.h})`}
                role="button"
                tabIndex={0}
                aria-pressed={selected === u.ecu}
                aria-label={`${u.ecu}, ${u.where}: ${faultsText(u)}`}
                onClick={() => pick(u.ecu)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    pick(u.ecu)
                  }
                }}
              >
                <title>{`${u.ecu}${u.title ? ` (${u.title})` : ''}, ${u.where}: ${faultsText(u)}${u.source ? `. ${tr('Source: {source}', { source: u.source })}` : ''}`}</title>
                <rect x={-15} y={-9} width={30} height={18} rx={4} />
                <text y={4} textAnchor="middle">{u.ecu}</text>
              </g>
            ))}
          </svg>
        )}
        <div className="fault-map-side">
          {map.units.length > 0 && (
            <ul className="fault-map-list">
              {map.units.map((u) => (
                <li key={u.ecu}>
                  <button type="button" className={`chip${selected === u.ecu ? ' on' : ''}`} onClick={() => pick(u.ecu)}>{u.ecu}</button>{' '}
                  <span className="muted">{u.where}:</span> {faultsText(u)}
                </li>
              ))}
            </ul>
          )}
          {map.unplaced.length > 0 && (
            <>
              <div className="sub-h">{tr('NOT PLACED')}</div>
              <ul className="fault-map-list">
                {map.unplaced.map((u) => (
                  <li key={u.ecu}>
                    <button type="button" className={`chip${selected === u.ecu ? ' on' : ''}`} onClick={() => pick(u.ecu)}>{u.ecu}</button>{' '}
                    {u.title && <span className="muted">{u.title}: </span>}{faultsText(u)}
                  </li>
                ))}
              </ul>
              <p className="muted note">
                {trn('To put it on the car, add to', 'To put them on the car, add to', map.unplaced.length)} <span className="mono">config/models/{id}/layout.yaml</span> ({tr('a zone:')}{' '}
                {Object.keys(ZONES).join(', ')}; {tr('or')} <span className="mono">at: [along, across, up]</span> {tr('as fractions of the car), then restart the dashboard:')}
              </p>
              <pre className="fault-map-yaml">{`units:\n${map.unplaced.map((u) => u.line).join('\n')}`}</pre>
            </>
          )}
        </div>
      </div>
      <ul className="car-notes muted">
        {FAULT_MAP_NOTES.map((n) => (
          <li key={n}>{tr(n)}</li>
        ))}
      </ul>
    </Panel>
  )
}
