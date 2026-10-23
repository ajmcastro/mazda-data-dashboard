import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useWarningDaily, useWarningEvents, useWarningFrequency } from '../api/hooks'
import type { WarningEvent, WarningFrequency } from '../api/types'
import { Badge, ChartTip, DataTable, Panel, QueryState, type Column } from '../components/ui'
import { ANIMATE, SEVERITY_BADGE, fmtTick, fmtDate, fmtDateTime, fmtNum, pivotDaily } from '../lib'
import { useDateRange } from '../range'

const PALETTE = ['var(--accent)', 'var(--amber)', 'var(--teal)', 'var(--steel)', '#b58bd6', '#d6b48b', '#8bd6c4']
const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }
const PAGE = 25

export default function Warnings() {
  const freq = useWarningFrequency()
  const daily = useWarningDaily()
  const { from, to } = useDateRange()
  const [chosen, setChosen] = useState<string | undefined>()
  const [hideNoisy, setHideNoisy] = useState(true)
  // the page number belongs to one period: changing the period starts again at page 1
  const rangeKey = `${from ?? ''}|${to ?? ''}`
  const [pager, setPager] = useState({ key: rangeKey, offset: 0 })
  const offset = pager.key === rangeKey ? pager.offset : 0
  const setOffset = (value: number) => setPager({ key: rangeKey, offset: value })

  const all = useMemo(() => freq.data ?? [], [freq.data])
  // a code picked earlier may have no events in the new period
  const selected = all.some((w) => w.code === chosen) ? chosen : undefined
  const events = useWarningEvents(selected, offset, PAGE)
  // A code present in over half of all events carries little signal on its own.
  const shown = useMemo(
    () => all.filter((w) => !hideNoisy || w.pct_of_events < 50).slice(0, 6).map((w) => w.code),
    [all, hideNoisy],
  )
  const chartData = useMemo(() => pivotDaily(daily.data ?? [], shown), [daily.data, shown])

  const columns: Column<WarningFrequency>[] = [
    { key: 'code', header: 'Code', render: (w) => <span className="mono">{w.code}</span>, sort: (w) => w.code },
    { key: 'title', header: 'Meaning', render: (w) => <span className={w.known ? '' : 'muted'}>{w.known ? w.title : 'not described yet'}</span>, sort: (w) => w.title },
    { key: 'sev', header: 'Severity', render: (w) => <Badge kind={SEVERITY_BADGE[w.severity] ?? 'dim'}>{w.severity}</Badge> },
    { key: 'events', header: 'Events', num: true, render: (w) => fmtNum(w.events), sort: (w) => w.events },
    {
      key: 'share', header: 'Share', sort: (w) => w.pct_of_events,
      render: (w) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="bar" style={{ width: 70 }}><i style={{ width: `${w.pct_of_events}%` }} /></div>
          <span className="mono muted">{fmtNum(w.pct_of_events, 1)}%</span>
        </div>
      ),
    },
    { key: 'days', header: 'Days', num: true, render: (w) => fmtNum(w.days_seen), sort: (w) => w.days_seen },
    { key: 'last', header: 'Last seen', render: (w) => fmtTick(Date.parse(w.last_seen)), sort: (w) => w.last_seen },
  ]

  const evCols: Column<WarningEvent>[] = [
    { key: 'at', header: 'When', render: (e) => fmtDateTime(e.triggered_at) },
    { key: 'code', header: 'Code', render: (e) => <span className="mono">{e.code}</span> },
    { key: 'odo', header: 'Odometer', num: true, render: (e) => fmtNum(e.odometer_km, 0, 'km') },
  ]

  const page = events.data
  const total = page?.total ?? 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Warnings</h1>
          <p>Warning-lamp events reported by the car. Codes are Mazda-specific; add meanings in <span className="mono">config/codes/warnings.yaml</span>.</p>
        </div>
      </div>

      <Panel
        title="Events per day"
        hint={
          <label className="toggle">
            <input type="checkbox" checked={hideNoisy} onChange={(e) => setHideNoisy(e.target.checked)} />
            hide codes in over half of all events
          </label>
        }
      >
        <QueryState query={daily}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart margin={{ right: 18, top: 5 }} data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d: string) => fmtTick(Date.parse(d))} minTickGap={36} {...axis} />
              <YAxis {...axis} width={34} />
              <Tooltip cursor={{ fill: 'var(--grid)' }} content={<ChartTip fmtLabel={(v) => fmtDate(String(v))} />} />
              {shown.map((code, i) => (
                <Bar isAnimationActive={ANIMATE} key={code} name={code} dataKey={code} stackId="w" fill={PALETTE[i % PALETTE.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div className="chips" style={{ marginTop: 8 }}>
            {shown.map((code, i) => (
              <span key={code} className="chip mono" style={{ borderColor: PALETTE[i % PALETTE.length] }}>{code}</span>
            ))}
          </div>
        </QueryState>
      </Panel>

      <div className="grid split" style={{ marginTop: 14 }}>
        <Panel title="Codes" hint="click a row to see its events">
          <QueryState query={freq}>
            <DataTable
              rows={all}
              columns={columns}
              rowKey={(w) => w.code}
              selected={selected}
              onSelect={(w) => { setChosen(selected === w.code ? undefined : w.code); setOffset(0) }}
            />
          </QueryState>
        </Panel>

        <Panel title={selected ? `Events · ${selected}` : 'Latest events'} hint={`${fmtNum(total)} total`}>
          <QueryState query={events}>
            <DataTable rows={page?.items ?? []} columns={evCols} rowKey={(e) => `${e.transaction_id}-${e.code}`} />
            <div className="pager">
              <span>{total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${fmtNum(total)}` : ''}</span>
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</button>
              <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          </QueryState>
        </Panel>
      </div>
    </>
  )
}
