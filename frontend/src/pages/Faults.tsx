import { t, tr } from '../i18n'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useDtcFrequency, useReadouts } from '../api/hooks'
import type { DtcFrequency } from '../api/types'
import { FaultDetail } from '../components/FaultDetail'
import { FaultMap } from '../components/FaultMap'
import { VoltagePanel } from '../components/VoltagePanel'
import { Badge, ChartTip, DataTable, Panel, QueryState, type Column } from '../components/ui'
import { ANIMATE, SEVERITY_BADGE, fmtDateTime, fmtNum, fmtTick, ts } from '../lib'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }
const key = (f: DtcFrequency) => `${f.ecu}|${f.dtc_code}|${f.failure_type ?? ''}`

export default function Faults() {
  const freq = useDtcFrequency()
  const readouts = useReadouts()
  const [selected, setSelected] = useState<string | undefined>()
  const sel = freq.data?.find((f) => key(f) === selected)
  // the fault map (M59): a unit picked there shows only its codes in the table
  const [unit, setUnit] = useState<string | null>(null)
  const shown = (freq.data ?? []).filter((f) => !unit || f.ecu === unit)

  const columns: Column<DtcFrequency>[] = [
    {
      key: 'state', header: tr('State'), sort: (f) => Number(f.active_in_latest_readout),
      render: (f) => f.active_in_latest_readout ? <Badge kind="critical">{tr('active')}</Badge> : <Badge kind="ok">{tr('cleared')}</Badge>,
    },
    { key: 'ecu', header: tr('ECU'), sort: (f) => f.ecu, render: (f) => <span title={f.ecu_title ?? ''}>{f.ecu}</span> },
    { key: 'code', header: tr('DTC'), sort: (f) => f.dtc_code, render: (f) => <span className="mono">{f.dtc_code}:{f.failure_type}</span> },
    { key: 'title', header: tr('Meaning'), sort: (f) => f.title, render: (f) => <span className={f.title.startsWith('Unknown') ? 'muted' : ''}>{f.title.startsWith('Unknown') ? tr('not described yet') : f.title}</span> },
    { key: 'sev', header: tr('Severity'), render: (f) => <Badge kind={SEVERITY_BADGE[f.severity] ?? 'dim'}>{tr(f.severity)}</Badge> },
    { key: 'n', header: tr('Seen'), num: true, sort: (f) => f.readouts, render: (f) => fmtNum(f.readouts) },
    { key: 'last', header: tr('Last'), sort: (f) => f.last_seen, render: (f) => fmtTick(Date.parse(f.last_seen)) },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('page.faults')}</h1>
          <p>{tr('Diagnostic trouble codes reported by the car\'s control units. “Active” means the latest read-out still lists it.')}</p>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <FaultMap faults={freq.data} selected={unit} onSelect={setUnit} />
      </div>

      <div className="grid split">
        <Panel title={tr('Trouble codes')} hint={unit ? <button type="button" onClick={() => setUnit(null)}>{tr('Only {unit}: show all', { unit })}</button> : tr('click a row for history and freeze-frame data')}>
          <QueryState query={freq}>
            <DataTable rows={shown} columns={columns} rowKey={key} selected={selected} onSelect={(f) => setSelected(selected === key(f) ? undefined : key(f))} />
          </QueryState>
        </Panel>

        <Panel title={tr('Read-outs')} hint={tr('faults and failed reads per diagnostic read-out')}>
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

      <div style={{ marginTop: 14 }}>
        <VoltagePanel />
      </div>
    </>
  )
}
