import { tr } from '../i18n'
import { Link } from 'react-router-dom'
import { useRefuels } from '../api/hooks'
import { useDayHref } from '../range'
import type { Refuel } from '../api/types'
import { fmtDate, fmtNum } from '../lib'
import { useCurrentModel } from '../model'
import { REFUEL_NOTES, amount, between, doubt, levels, matchLine, missingSetting, paidCell, sincePrevious, summaryLine } from '../refuels'
import { Badge, DataTable, Panel, QueryState, type Column } from './ui'

/** The fill-ups of the period: rises of the fuel level between two status reports (PLAN.md M47). */
export function FillUpsPanel() {
  const query = useRefuels()
  const { id } = useCurrentModel()
  const dayHref = useDayHref()
  const d = query.data
  const columns: Column<Refuel>[] = [
    {
      key: 'when', header: tr('Seen by'), sort: (r) => r.after_at,
      render: (r) => (
        <span title={between(r)}>
          <Link to={dayHref(r.after_at.slice(0, 10))}>{fmtDate(r.after_at)}</Link> {r.doubtful && <Badge kind="warning">{tr('doubtful')}</Badge>}
        </span>
      ),
    },
    { key: 'level', header: tr('Fuel level'), num: true, sort: (r) => r.points, render: (r) => levels(r) },
    { key: 'amount', header: tr('Filled'), num: true, sort: (r) => r.litres ?? r.points, render: (r) => amount(r) },
    { key: 'since', header: tr('Since the one before'), num: true, sort: (r) => r.km_since_previous ?? -1, render: (r) => sincePrevious(r) },
    {
      key: 'cost', header: tr('Estimated cost'), num: true, sort: (r) => r.est_cost ?? -1,
      render: (r) => (r.est_cost == null ? '—' : `${fmtNum(r.est_cost, 2)}${d?.currency ? ` ${d.currency}` : ''}`),
    },
    { key: 'paid', header: tr('Paid'), num: true, sort: (r) => r.paid ?? -1, render: (r) => paidCell(r, d?.currency) },
  ]
  const doubts = (d?.refuels ?? []).flatMap((r) => {
    const why = doubt(r, d?.min_points ?? 15)
    return why ? [`${fmtDate(r.after_at)}: ${why}.`] : []
  })
  return (
    <Panel title={tr('Fill-ups')} hint={tr('rises of the fuel level between two status reports')}>
      <QueryState query={query}>
        {d && (
          <>
            <p style={{ margin: '0 0 10px' }}>{summaryLine(d)}</p>
            {missingSetting(d, id) && <p className="muted note" style={{ margin: '0 0 10px' }}>{missingSetting(d, id)}</p>}
            {d.refuels.length > 0 && <DataTable rows={d.refuels} columns={columns} rowKey={(r) => r.after_at} />}
            {doubts.map((line) => (
              <p key={line} className="muted note">{line}</p>
            ))}
            {d.refuels.flatMap((r) => {
              const line = matchLine(r)
              return line ? [<p key={`m-${r.after_at}`} className="muted note">{line}</p>] : []
            })}
            {d.unmatched.length > 0 && (
              <p className="muted note">
                {tr('Payments in your fuel log with no fill-up seen around their date:')}{' '}
                {d.unmatched.map((p) => `${fmtDate(p.paid_on)} (${fmtNum(p.paid, 2)}${d.currency ? ` ${d.currency}` : ''})`).join(', ')}.
              </p>
            )}
            {d.refuels.length > 0 && (
              <ul className="car-notes muted">
                {REFUEL_NOTES.map((n) => (
                  <li key={n}>{tr(n)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </QueryState>
    </Panel>
  )
}
