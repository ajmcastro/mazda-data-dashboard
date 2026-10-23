import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useDtcFrequency, useReadouts } from '../api/hooks'
import type { DtcFrequency } from '../api/types'
import { FaultDetail } from '../components/FaultDetail'
import { Badge, ChartTip, DataTable, Panel, QueryState, type Column } from '../components/ui'
import { ANIMATE, SEVERITY_BADGE, fmtDateTime, fmtNum, fmtTick, ts } from '../lib'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }
const key = (f: DtcFrequency) => `${f.ecu}|${f.dtc_code}|${f.failure_type ?? ''}`

export default function Faults() {
  const freq = useDtcFrequency()
  const readouts = useReadouts()
  const [selected, setSelected] = useState<string | undefined>()
  const sel = freq.data?.find((f) => key(f) === selected)

  const columns: Column<DtcFrequency>[] = [
    {
      key: 'state', header: 'State', sort: (f) => Number(f.active_in_latest_readout),
      render: (f) => f.active_in_latest_readout ? <Badge kind="critical">active</Badge> : <Badge kind="ok">cleared</Badge>,
    },
    { key: 'ecu', header: 'ECU', sort: (f) => f.ecu, render: (f) => <span title={f.ecu_title ?? ''}>{f.ecu}</span> },
    { key: 'code', header: 'DTC', sort: (f) => f.dtc_code, render: (f) => <span className="mono">{f.dtc_code}:{f.failure_type}</span> },
    { key: 'title', header: 'Meaning', sort: (f) => f.title, render: (f) => <span className={f.title.startsWith('Unknown') ? 'muted' : ''}>{f.title.startsWith('Unknown') ? 'not described yet' : f.title}</span> },
    { key: 'sev', header: 'Severity', render: (f) => <Badge kind={SEVERITY_BADGE[f.severity] ?? 'dim'}>{f.severity}</Badge> },
    { key: 'n', header: 'Seen', num: true, sort: (f) => f.readouts, render: (f) => fmtNum(f.readouts) },
    { key: 'last', header: 'Last', sort: (f) => f.last_seen, render: (f) => fmtTick(Date.parse(f.last_seen)) },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Faults</h1>
          <p>Diagnostic trouble codes reported by the car's control units. “Active” means the latest read-out still lists it.</p>
        </div>
      </div>

      <div className="grid split">
        <Panel title="Trouble codes" hint="click a row for history and freeze-frame data">
          <QueryState query={freq}>
            <DataTable rows={freq.data ?? []} columns={columns} rowKey={key} selected={selected} onSelect={(f) => setSelected(selected === key(f) ? undefined : key(f))} />
          </QueryState>
        </Panel>

        <Panel title="Read-outs" hint="faults and failed reads per diagnostic read-out">
          <QueryState query={readouts}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart margin={{ right: 18, top: 5 }} data={[...(readouts.data ?? [])].reverse().map((r) => ({ t: ts(r.event_at), faults: r.faults, 'read errors': r.read_errors }))}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} minTickGap={36} {...axis} />
                <YAxis {...axis} width={30} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'var(--grid)' }} content={<ChartTip fmtLabel={(v) => fmtDateTime(new Date(Number(v)).toISOString())} />} />
                <Bar isAnimationActive={ANIMATE} dataKey="faults" stackId="r" fill="var(--accent)" />
                <Bar isAnimationActive={ANIMATE} dataKey="read errors" stackId="r" fill="var(--steel)" />
              </BarChart>
            </ResponsiveContainer>
          </QueryState>
        </Panel>
      </div>

      {sel && <FaultDetail key={key(sel)} fault={sel} />}
    </>
  )
}
