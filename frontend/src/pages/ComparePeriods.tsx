import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useMonthlyRange } from '../api/hooks'
import {
  comparePeriods,
  describeDifference,
  periodLabel,
  periodPresets,
  validatePeriods,
  type Period,
  type PeriodComparison,
} from '../compare'
import { Panel } from '../components/ui'
import { ANIMATE, addDays, fmtNum } from '../lib'
import { useCurrentModel } from '../model'
import { METRICS, currencyOf, digitsFor, unitFor, unitLabel, type MetricDef, type Tone } from '../trends'

// The same two cues as the two-cars view: colour and (here) position; the earlier period is always first.
const COLOR = { a: 'var(--steel)', b: 'var(--amber)' } as const
const TONE_CLASS: Record<Tone, string> = { good: 'tone-good', bad: 'tone-bad', neutral: 'tone-neutral' }

function PeriodCard({ def, c, names, perDay, currency }: { def: MetricDef; c: PeriodComparison; names: { a: string; b: string }; perDay: boolean; currency: string | null }) {
  const digits = digitsFor(def, perDay)
  const unit = unitFor(def, perDay, currency)
  const data = [
    { label: 'A', name: names.a, value: c.a.value, color: COLOR.a },
    { label: 'B', name: names.b, value: c.b.value, color: COLOR.b },
  ]
  const figure = (side: 'a' | 'b') => {
    const v = c[side].value
    return (
      <div className="cmp-figure">
        <span className={`cmp-key ${side}`} aria-hidden="true" />
        <div>
          <div className="muted cmp-name">{names[side]}</div>
          <div className="metric-value">
            {v === null ? <span className="muted">–</span> : fmtNum(v, digits)}
            {v !== null && <small>{unitLabel(def, perDay, v, currency)}</small>}
          </div>
        </div>
      </div>
    )
  }
  return (
    <article className="panel metric" aria-label={def.label}>
      <div className="metric-head">
        <h3 title={def.help}>{def.label}</h3>
        <span className="muted mono">{unit}</span>
      </div>
      <div className="cmp-figures">
        {figure('a')}
        {figure('b')}
      </div>
      <div className={`change ${TONE_CLASS[c.tone]}`}>
        {c.kind === 'ok' && c.direction !== 'flat' && <span aria-hidden="true">{c.direction === 'up' ? '▲' : '▼'} </span>}
        {describeDifference(def, names, c, perDay, currency)}
      </div>
      {c.kind === 'ok' && (
        <div className="metric-chart" aria-hidden="true">
          <ResponsiveContainer width="100%" height={90}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--muted)" fontSize={11} fontFamily="var(--mono)" />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip
                cursor={{ fill: 'var(--grid)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as (typeof data)[number]
                  return (
                    <div className="chart-tip">
                      <div className="t">{d.name}</div>
                      <div className="row">
                        <span>{def.label}</span>
                        <span>{d.value === null ? 'no data' : `${fmtNum(d.value, digits)} ${unit}`}</span>
                      </div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="value" isAnimationActive={ANIMATE} radius={[3, 3, 0, 0]}>
                {data.map((d) => (
                  <Cell key={d.label} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  )
}

/** Two periods of the car on screen (change the car with the model selector). */
export default function ComparePeriods() {
  const { model, id, name } = useCurrentModel()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const first = model?.first_day ?? undefined
  const last = model?.last_day ?? undefined

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) p.delete(k)
          else p.set(k, v)
        }
        return p
      },
      { replace: true },
    )

  const around = params.get('around') ?? undefined
  const presets = first && last ? periodPresets(first, last, around) : []
  const chosen = params.get('preset') ?? 'last30'
  const preset = presets.find((p) => p.id === chosen)
  const custom = chosen === 'custom'
  const read = (k: string, fallback: string) => params.get(k) ?? fallback
  const fallback = presets.find((p) => p.available) ?? presets[0]
  const base = preset ?? fallback
  const a: Period | undefined = custom ? { from: read('af', base?.a.from ?? ''), to: read('at', base?.a.to ?? '') } : base?.a
  const b: Period | undefined = custom ? { from: read('bf', base?.b.from ?? ''), to: read('bt', base?.b.to ?? '') } : base?.b
  const perDay = params.get('perday') !== '0'

  const rowsA = useMonthlyRange(id, a?.from, a?.to)
  const rowsB = useMonthlyRange(id, b?.from, b?.to)
  const problems = a && b && first && last ? validatePeriods(a, b, first, last) : []
  const names = { a: a ? periodLabel(a) : '', b: b ? periodLabel(b) : '' }
  const currency = currencyOf([...(rowsA.data ?? []), ...(rowsB.data ?? [])])
  const metrics = METRICS.filter((d) => !d.money || currency !== null)
  const blocking = problems.filter((p) => !p.includes('overlap'))
  const pending = rowsA.isPending || rowsB.isPending
  const error = rowsA.error ?? rowsB.error

  const dateInput = (label: string, key: string, value: string) => (
    <label key={key}>
      {label}
      <input type="date" value={value} min={first} max={last} onChange={(e) => set({ ...(chosen === 'custom' ? {} : seed()), preset: 'custom', [key]: e.target.value || null })} />
    </label>
  )
  /** Switching to "custom" keeps the periods that were on screen, instead of jumping to others. */
  const seed = (): Record<string, string | null> => ({ af: a?.from ?? null, at: a?.to ?? null, bf: b?.from ?? null, bt: b?.to ?? null })

  if (!first || !last) {
    return (
      <Panel>
        <div className="state">No data for {name} yet.</div>
      </Panel>
    )
  }

  return (
    <>
      <p className="muted cmp-intro">
        Two periods of {name}. The earlier one comes first, and since it is the same car, the colours say whether a change is good (teal) or bad (red) for that figure.
      </p>
      <div className="controls">
        <label>
          Compare
          <select
            className="car-select period-select"
            value={custom ? 'custom' : base?.id}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'custom') set({ preset: 'custom', ...seed() })
              else if (v === 'around-pick') set({ preset: 'around', around: addDays(last, -29), af: null, at: null, bf: null, bt: null })
              else set({ preset: v, af: null, at: null, bf: null, bt: null })
            }}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.label}
                {p.available ? '' : ' (no data then)'}
              </option>
            ))}
            {!around && <option value="around-pick">Before and after a date…</option>}
            <option value="custom">Choose the periods</option>
          </select>
        </label>
        {chosen === 'around' && (
          <label>
            Date
            <input type="date" value={around ?? ''} min={first} max={last} onChange={(e) => set({ around: e.target.value || null, preset: 'around', af: null, at: null, bf: null, bt: null })} />
          </label>
        )}
        {custom && (
          <>
            {dateInput('First from', 'af', a?.from ?? '')}
            {dateInput('First to', 'at', a?.to ?? '')}
            {dateInput('Second from', 'bf', b?.from ?? '')}
            {dateInput('Second to', 'bt', b?.to ?? '')}
          </>
        )}
        <div className="chips" role="radiogroup" aria-label="View">
          {(['cards', 'table'] as const).map((v) => (
            <label key={v} className="preset">
              <input type="radio" name="cmp-pview" checked={view === v} onChange={() => setView(v)} />
              <span>{v === 'cards' ? 'Charts' : 'Table'}</span>
            </label>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={perDay} onChange={(e) => set({ perday: e.target.checked ? null : '0' })} />
          per day
        </label>
      </div>

      {problems.length > 0 && (
        <div className="alert-row" style={{ marginBottom: 14 }} role="status">
          <b>{blocking.length ? 'These periods cannot be compared' : 'Note'}</b>
          <span className="muted">{problems.join(' ')}</span>
        </div>
      )}
      {blocking.length > 0 || !a || !b ? null : pending ? (
        <div className="skeleton" aria-busy="true" />
      ) : error ? (
        <div className="state error" role="alert">{error.message}</div>
      ) : (
        <>
          <div className="alert-row" style={{ marginBottom: 14 }}>
            <b>
              {names.a} against {names.b}
            </b>
            <span className="muted">
              {perDay ? 'Totals are per day, so periods of unequal length compare fairly.' : 'Totals are the sum over the whole period.'} A month cut by a period counts only its days inside it.
            </span>
          </div>
          {view === 'cards' ? (
            <div className="cards">
              {metrics.map((def) => (
                <PeriodCard key={def.key} def={def} c={comparePeriods(def, rowsA.data ?? [], rowsB.data ?? [], perDay)} names={names} perDay={perDay} currency={currency} />
              ))}
            </div>
          ) : (
            <Panel>
              <div className="table-wrap">
                <table className="trend-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th className="num">{names.a}</th>
                      <th className="num">{names.b}</th>
                      <th>Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((def) => {
                      const c = comparePeriods(def, rowsA.data ?? [], rowsB.data ?? [], perDay)
                      const cell = (v: number | null) => (v === null ? <span className="muted">–</span> : fmtNum(v, digitsFor(def, perDay)))
                      return (
                        <tr key={def.key}>
                          <th scope="row" title={def.help}>
                            {def.label} <span className="muted mono">{unitFor(def, perDay, currency)}</span>
                          </th>
                          <td className="num mono">{cell(c.a.value)}</td>
                          <td className="num mono">{cell(c.b.value)}</td>
                          <td className={TONE_CLASS[c.tone]}>{describeDifference(def, names, c, perDay, currency)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  )
}
