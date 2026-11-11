import { useState, type ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useMonthlyOf } from '../api/hooks'
import {
  COMPARABILITY,
  LEVEL_LABEL,
  alignMonths,
  compareMetric,
  describeBasis,
  describeDifference,
  pickPair,
  type AlignedMonth,
  type Basis,
  type MetricComparison,
} from '../compare'
import { Panel } from '../components/ui'
import { ANIMATE, fmtNum, isPageHidden, shortModelName } from '../lib'
import { useCurrentModel } from '../model'
import { METRICS, digitsFor, metricValue, monthLabel, monthShort, unitFor, unitLabel, type MetricDef } from '../trends'

// Two cars, told apart by colour AND by marker shape and dash, so colour is not the only cue.
const COLOR = { a: 'var(--steel)', b: 'var(--amber)' } as const

type Side = 'a' | 'b'
const dot = (side: Side) =>
  function Dot(props: { cx?: number; cy?: number; index?: number }): ReactElement {
    const { cx = 0, cy = 0, index = 0 } = props
    const key = `${side}-${index}`
    return side === 'a' ? (
      <circle key={key} cx={cx} cy={cy} r={4} fill={COLOR.a} />
    ) : (
      <rect key={key} x={cx - 4} y={cy - 4} width={8} height={8} fill={COLOR.b} />
    )
  }

function Figure({ value, def, perDay, side, name }: { value: number | null; def: MetricDef; perDay: boolean; side: Side; name: string }) {
  return (
    <div className="cmp-figure">
      <span className={`cmp-key ${side}`} aria-hidden="true" />
      <div>
        <div className="muted cmp-name">{name}</div>
        <div className="metric-value">
          {value === null ? <span className="muted">no data</span> : fmtNum(value, digitsFor(def, perDay))}
          {value !== null && <small>{unitLabel(def, perDay, value)}</small>}
        </div>
      </div>
    </div>
  )
}

function MetricCard({ def, aligned, c, names, perDay }: { def: MetricDef; aligned: AlignedMonth[]; c: MetricComparison; names: { a: string; b: string }; perDay: boolean }) {
  const level = COMPARABILITY[def.key]
  const digits = digitsFor(def, perDay)
  const unit = unitFor(def, perDay)
  const data = aligned.map((m) => ({
    month: m.month,
    label: monthShort(m.month),
    a: m.a ? metricValue(m.a, def, perDay) : null,
    b: m.b ? metricValue(m.b, def, perDay) : null,
  }))
  return (
    <article className="panel metric" aria-label={def.label}>
      <div className="metric-head">
        <h3 title={def.help}>{def.label}</h3>
        <span className="muted mono">{unit}</span>
      </div>
      <span className={`level ${level.level}`} title={level.why}>
        {LEVEL_LABEL[level.level]}
      </span>
      <div className="cmp-figures">
        <Figure value={c.a.value} def={def} perDay={perDay} side="a" name={names.a} />
        <Figure value={c.b.value} def={def} perDay={perDay} side="b" name={names.b} />
      </div>
      <div className="change tone-neutral">
        {c.kind === 'ok' && c.direction !== 'flat' && <span aria-hidden="true">{c.direction === 'up' ? '▲' : '▼'} </span>}
        {describeDifference(def, names, c, perDay)}
        {c.kind !== 'none' && (
          <span className="muted">
            {' '}
            · {c.a.months === c.b.months ? `${c.a.months} month${c.a.months === 1 ? '' : 's'}` : `${c.a.months} and ${c.b.months} months`}
          </span>
        )}
      </div>
      <p className="muted cmp-why">{level.why}</p>
      <div className="metric-chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--muted)" fontSize={10} fontFamily="var(--mono)" interval="preserveStartEnd" />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as (typeof data)[number]
                return (
                  <div className="chart-tip">
                    <div className="t">{monthLabel(d.month)}</div>
                    {(['a', 'b'] as const).map((s) => (
                      <div className="row" key={s}>
                        <span>{names[s]}</span>
                        <span>{d[s] === null ? 'no data' : `${fmtNum(d[s], digits)} ${unit}`}</span>
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            <Line type="monotone" dataKey="a" stroke={COLOR.a} strokeWidth={2} dot={dot('a')} isAnimationActive={ANIMATE} connectNulls={false} />
            <Line type="monotone" dataKey="b" stroke={COLOR.b} strokeWidth={2} strokeDasharray="5 3" dot={dot('b')} isAnimationActive={ANIMATE} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  )
}

function CompareTable({ aligned, names, perDay, basis }: { aligned: AlignedMonth[]; names: { a: string; b: string }; perDay: boolean; basis: Basis }) {
  return (
    <div className="table-wrap">
      <table className="trend-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">{names.a}</th>
            <th className="num">{names.b}</th>
            <th>Difference</th>
            <th>Fair to compare?</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((def) => {
            const c = compareMetric(def, aligned, perDay, basis)
            const level = COMPARABILITY[def.key]
            const cell = (v: number | null) => (v === null ? <span className="muted">–</span> : fmtNum(v, digitsFor(def, perDay)))
            return (
              <tr key={def.key}>
                <th scope="row" title={def.help}>
                  {def.label} <span className="muted mono">{unitFor(def, perDay)}</span>
                </th>
                <td className="num mono">{cell(c.a.value)}</td>
                <td className="num mono">{cell(c.b.value)}</td>
                <td className="muted">{describeDifference(def, names, c, perDay)}</td>
                <td>
                  <span className={`level ${level.level}`} title={level.why}>
                    {LEVEL_LABEL[level.level]}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Compare() {
  const { models, id: current } = useCurrentModel()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'cards' | 'table'>('cards')

  // only cars that have data and show the Trends page can be compared
  const choices = models.filter((m) => m.has_data && !isPageHidden('/trends', m.hidden_pages))
  const { a, b } = pickPair(choices, { a: params.get('a'), b: params.get('b') }, current)
  const basis: Basis = params.get('basis') === 'all' ? 'all' : 'overlap'
  const perDay = params.get('perday') !== '0'
  const includePartial = params.get('partial') === '1'
  const set = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (value === null) p.delete(key)
        else p.set(key, value)
        return p
      },
      { replace: true },
    )

  const first = useMonthlyOf(a?.id)
  const second = useMonthlyOf(b?.id)
  const names = { a: shortModelName(a?.name ?? ''), b: shortModelName(b?.name ?? '') }
  const aligned = alignMonths({ label: names.a, rows: first.data ?? [] }, { label: names.b, rows: second.data ?? [] }, basis, includePartial)
  const pending = first.isPending || second.isPending
  const error = first.error ?? second.error

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Compare cars</h1>
          <p>
            Two cars side by side, month by month. A different car is not a better or a worse one, so the page only
            says higher and lower, and marks every figure that is not fair to compare.
          </p>
        </div>
        {choices.length >= 2 && a && b && (
          <div className="controls">
            {(['a', 'b'] as const).map((side) => (
              <label key={side}>
                {side === 'a' ? 'Car' : 'Against'}
                <select
                  className="car-select"
                  value={(side === 'a' ? a : b).id}
                  onChange={(e) => set(side, e.target.value)}
                >
                  {choices
                    .filter((m) => m.id !== (side === 'a' ? b : a).id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <div className="chips" role="radiogroup" aria-label="Months">
              {(['overlap', 'all'] as const).map((v) => (
                <label key={v} className="preset">
                  <input type="radio" name="cmp-basis" checked={basis === v} onChange={() => set('basis', v === 'all' ? 'all' : null)} />
                  <span>{v === 'overlap' ? 'Months in common' : 'All data'}</span>
                </label>
              ))}
            </div>
            <div className="chips" role="radiogroup" aria-label="View">
              {(['cards', 'table'] as const).map((v) => (
                <label key={v} className="preset">
                  <input type="radio" name="cmp-view" checked={view === v} onChange={() => setView(v)} />
                  <span>{v === 'cards' ? 'Charts' : 'Table'}</span>
                </label>
              ))}
            </div>
            <label className="toggle">
              <input type="checkbox" checked={perDay} onChange={(e) => set('perday', e.target.checked ? null : '0')} />
              per day
            </label>
            <label className="toggle">
              <input type="checkbox" checked={includePartial} onChange={(e) => set('partial', e.target.checked ? '1' : null)} />
              incomplete months
            </label>
          </div>
        )}
      </div>

      {choices.length < 2 || !a || !b ? (
        <Panel>
          <div className="state">
            Comparing needs two car models with data. {choices.length === 1 && <>Only {choices[0].name} has data so far: put the other car's exports in <code>data/&lt;model&gt;/</code> and run <code>make ingest MODEL=&lt;model&gt;</code>.</>}
          </div>
        </Panel>
      ) : pending ? (
        <div className="skeleton" aria-busy="true" />
      ) : error ? (
        <div className="state error" role="alert">{error.message}</div>
      ) : (
        <>
          <div className="alert-row" style={{ marginBottom: 14 }}>
            <b>{describeBasis(aligned, basis, includePartial)}</b>
            <span className="muted">
              {perDay ? 'Totals are shown per day, so months of unequal length compare fairly.' : 'Totals are the average of a month.'}
              {!includePartial && ' Months that are not complete are left out.'}
            </span>
          </div>
          {aligned.length === 0 ? (
            <Panel>
              <div className="state">
                {names.a} and {names.b} have no {includePartial ? '' : 'complete '}month in common. Show “All data” to look at each car on its own.
              </div>
            </Panel>
          ) : view === 'cards' ? (
            <div className="cards">
              {METRICS.map((def) => (
                <MetricCard key={def.key} def={def} aligned={aligned} c={compareMetric(def, aligned, perDay, basis)} names={names} perDay={perDay} />
              ))}
            </div>
          ) : (
            <Panel>
              <CompareTable aligned={aligned} names={names} perDay={perDay} basis={basis} />
            </Panel>
          )}
        </>
      )}
    </>
  )
}
