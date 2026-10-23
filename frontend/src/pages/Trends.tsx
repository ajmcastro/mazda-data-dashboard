import { useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useMonthly } from '../api/hooks'
import type { MonthMetrics } from '../api/types'
import { Panel, QueryState } from '../components/ui'
import { ANIMATE, fmtNum } from '../lib'
import {
  ARROW,
  METRICS,
  compare,
  describeChange,
  digitsFor,
  latestIndex,
  metricValue,
  monthLabel,
  monthShort,
  shortChange,
  unitFor,
  unitLabel,
  type Comparison,
  type MetricDef,
  type Tone,
} from '../trends'

const TONE_CLASS: Record<Tone, string> = { good: 'tone-good', bad: 'tone-bad', neutral: 'tone-neutral' }

function ChangeLine({ c, previousMonth }: { c: Comparison; previousMonth?: string }) {
  const tone = c.kind === 'ok' ? c.tone : 'neutral'
  return (
    <div className={`change ${TONE_CLASS[tone]}`}>
      {c.kind === 'ok' && <span aria-hidden="true">{ARROW[c.direction]} </span>}
      {describeChange(c, previousMonth)}
      {c.kind === 'ok' && c.partialCaveat && (
        <span className="caveat" title="One of the two months is not complete. Switch on “per day” to compare fairly.">
          {' '}
          · partial month
        </span>
      )}
    </div>
  )
}

function MetricCard({ def, rows, perDay }: { def: MetricDef; rows: MonthMetrics[]; perDay: boolean }) {
  const values = rows.map((r) => metricValue(r, def, perDay))
  const partial = rows.map((r) => r.partial)
  const last = latestIndex(values)
  const digits = digitsFor(def, perDay)
  const unit = unitFor(def, perDay)
  const comparison = last >= 0 ? compare(def, values, partial, last, perDay) : ({ kind: 'no-value' } as const)
  const data = rows.map((r, i) => ({ month: r.month, label: monthShort(r.month), value: values[i], partial: r.partial, i }))

  return (
    <article className="panel metric" aria-label={def.label}>
      <div className="metric-head">
        <h3 title={def.help}>{def.label}</h3>
        <span className="muted mono">{unit}</span>
      </div>
      {last < 0 ? (
        <div className="metric-value muted">no data</div>
      ) : (
        <>
          <div className="metric-value">
            {fmtNum(values[last], digits)}
            <small>
              {unitLabel(def, perDay, values[last])} · {monthLabel(rows[last].month)}
            </small>
          </div>
          <ChangeLine c={comparison} previousMonth={rows[last - 1]?.month} />
        </>
      )}
      <div className="metric-chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--muted)" fontSize={10} fontFamily="var(--mono)" interval="preserveStartEnd" />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip
              cursor={{ fill: 'var(--grid)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as (typeof data)[number]
                const c = compare(def, values, partial, d.i, perDay)
                return (
                  <div className="chart-tip">
                    <div className="t">
                      {monthLabel(d.month)}
                      {d.partial ? ' (partial)' : ''}
                    </div>
                    <div className="row">
                      <span>{def.label}</span>
                      <span>
                        {d.value === null ? 'no data' : `${fmtNum(d.value, digits)} ${unit}`}
                      </span>
                    </div>
                    <div className={`${TONE_CLASS[c.kind === 'ok' ? c.tone : 'neutral']}`}>
                      {describeChange(c, rows[d.i - 1]?.month)}
                    </div>
                  </div>
                )
              }}
            />
            <Bar dataKey="value" isAnimationActive={ANIMATE} radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell
                  key={d.month}
                  fill={d.i === last ? 'var(--accent)' : 'var(--steel)'}
                  fillOpacity={d.partial ? 0.45 : 1}
                  stroke={d.partial ? (d.i === last ? 'var(--accent)' : 'var(--steel)') : 'none'}
                  strokeDasharray={d.partial ? '3 2' : undefined}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  )
}

function TrendTable({ rows, perDay }: { rows: MonthMetrics[]; perDay: boolean }) {
  return (
    <div className="table-wrap">
      <table className="trend-table">
        <thead>
          <tr>
            <th>Metric</th>
            {rows.map((r) => (
              <th key={r.month} className="num">
                {monthLabel(r.month)}
                {r.partial && <div className="muted partial-tag">partial · {r.days_covered}/{r.days_in_month} d</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((def) => {
            const values = rows.map((r) => metricValue(r, def, perDay))
            const partial = rows.map((r) => r.partial)
            const digits = digitsFor(def, perDay)
            return (
              <tr key={def.key}>
                <th scope="row" title={def.help}>
                  {def.label} <span className="muted mono">{unitFor(def, perDay)}</span>
                </th>
                {values.map((v, i) => {
                  const c = compare(def, values, partial, i, perDay)
                  return (
                    <td key={rows[i].month} className="num mono">
                      {v === null ? <span className="muted">–</span> : fmtNum(v, digits)}
                      {c.kind === 'ok' && (
                        <div className={`cell-change ${TONE_CLASS[c.tone]}`} title={describeChange(c, rows[i - 1]?.month)}>
                          {ARROW[c.direction]} {shortChange(c)}
                          {c.partialCaveat && <span className="caveat" title="Compared with a month that is not complete"> *</span>}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Trends() {
  const monthly = useMonthly()
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [perDay, setPerDay] = useState(false)
  const rows = useMemo(() => monthly.data ?? [], [monthly.data])
  const partialMonths = rows.filter((r) => r.partial)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Trends</h1>
          <p>How each figure changed from month to month. The newest month is in red; the arrow compares it with the month before.</p>
        </div>
        <div className="controls">
          <div className="chips" role="radiogroup" aria-label="View">
            {(['cards', 'table'] as const).map((v) => (
              <label key={v} className="preset">
                <input type="radio" name="trend-view" checked={view === v} onChange={() => setView(v)} />
                <span>{v === 'cards' ? 'Charts' : 'Table'}</span>
              </label>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={perDay} onChange={(e) => setPerDay(e.target.checked)} />
            per day
          </label>
        </div>
      </div>

      <QueryState query={monthly}>
        {rows.length === 0 ? (
          <Panel>
            <div className="state">No months in this period.</div>
          </Panel>
        ) : (
          <>
            {partialMonths.length > 0 && (
              <div className="alert-row" style={{ marginBottom: 14 }}>
                <b>
                  {partialMonths.length === 1 ? '1 month is' : `${partialMonths.length} months are`} not complete
                </b>
                <span className="muted">
                  {partialMonths.map((m) => `${monthLabel(m.month)} (${m.days_covered}/${m.days_in_month} days)`).join(', ')}.
                  {!perDay && ' Totals are lower for them; tick “per day” to compare fairly.'}
                </span>
              </div>
            )}
            {view === 'cards' ? (
              <div className="cards">
                {METRICS.map((def) => (
                  <MetricCard key={def.key} def={def} rows={rows} perDay={perDay} />
                ))}
              </div>
            ) : (
              <Panel>
                <TrendTable rows={rows} perDay={perDay} />
                {partialMonths.length > 0 && !perDay && (
                  <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
                    <span className="caveat">*</span> compared with a month that is not complete; tick “per day” for a like-for-like view.
                  </p>
                )}
              </Panel>
            )}
          </>
        )}
      </QueryState>
    </>
  )
}
