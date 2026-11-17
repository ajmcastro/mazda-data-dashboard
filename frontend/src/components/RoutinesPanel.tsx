// The car's recurring kinds of stretch (PLAN.md M66), over all the data. Wording in `routines.ts`: never a
// place, never a judgement of the driver.
import { tr } from '../i18n'
import { useRoutines } from '../api/hooks'
import { ROUTINES_NOTE, otherLine, routineLine, routineTitle, summaryLine } from '../routines'
import { Panel, QueryState } from './ui'

export function RoutinesPanel() {
  const query = useRoutines()
  const r = query.data
  const other = otherLine(r)
  return (
    <Panel title={tr('Routines')} hint={tr('all the data, not just the period')}>
      <QueryState query={query}>
        <p style={{ marginTop: 0 }}>{summaryLine(r)}</p>
        {r && r.routines.length > 0 && (
          <ul className="steps-list">
            {r.routines.map((x) => (
              <li key={x.routine}>
                <strong>{routineTitle(x)}</strong>
                <span className="muted">{routineLine(x)}</span>
                <div className="bar" style={{ width: '100%', maxWidth: 280 }} aria-hidden="true">
                  <i style={{ width: `${x.km_share_pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {other && <p className="muted">{other}</p>}
        {r && <p className="muted note">{tr(ROUTINES_NOTE, { n: r.min_stretches, days: r.min_days })}</p>}
      </QueryState>
    </Panel>
  )
}
