// The reports least like the car's other reports (PLAN.md M64). Wording in `unusual.ts`: unlike the others,
// never a fault.
import { Link } from 'react-router-dom'
import { tr } from '../i18n'
import { useUnusualReports } from '../api/hooks'
import { UNUSUAL_NOTE, moments, reasonText, summaryLine } from '../unusual'
import { useDayHref } from '../range'
import { Panel, QueryState } from './ui'

export function UnusualPanel() {
  const query = useUnusualReports()
  const dayHref = useDayHref()
  const u = query.data
  const list = moments(u?.reports)
  return (
    <Panel title={tr('Unusual reports')} hint={tr('reports least like this car’s others')}>
      <QueryState query={query}>
        <p style={{ marginTop: 0 }}>{summaryLine(u)}</p>
        {list.length > 0 && (
          <ul className="unusual-list">
            {list.map((m) => (
              <li key={m.at}>
                <Link className="mono" to={dayHref(m.local.slice(0, 10))}>{m.local}</Link>
                <span>{m.reasons.map(reasonText).join('; ')}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted note">{tr(UNUSUAL_NOTE, { z: u?.threshold_z ?? 3.5, pct: u?.rare_pct ?? 1 })}</p>
      </QueryState>
    </Panel>
  )
}
