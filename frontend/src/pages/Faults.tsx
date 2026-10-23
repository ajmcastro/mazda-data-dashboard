import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useDtcEvents, useDtcFrequency, useReadouts, useSnapshots } from '../api/hooks'
import type { DtcEvent, DtcFrequency } from '../api/types'
import { Badge, ChartTip, DataTable, Panel, QueryState, type Column } from '../components/ui'
import { SEVERITY_BADGE, fmtDateTime, fmtNum, fmtTick, ts } from '../lib'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }
const key = (f: DtcFrequency) => `${f.ecu}|${f.dtc_code}|${f.failure_type ?? ''}`

export default function Faults() {
  const freq = useDtcFrequency()
  const readouts = useReadouts()
  const [selected, setSelected] = useState<string | undefined>()
  const sel = freq.data?.find((f) => key(f) === selected)
  const events = useDtcEvents(sel?.ecu, sel?.dtc_code)
  const snaps = useSnapshots(sel?.ecu, sel?.dtc_code)

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

  const evCols: Column<DtcEvent>[] = [
    { key: 'at', header: 'When', render: (e) => fmtDateTime(e.event_at) },
    { key: 'odo', header: 'Odometer', num: true, render: (e) => fmtNum(e.odometer_km, 0, 'km') },
    { key: 'conf', header: 'Confirmed', render: (e) => (e.confirmed === null || e.confirmed === undefined ? '—' : e.confirmed ? 'yes' : 'no') },
    { key: 'pend', header: 'Pending', render: (e) => (e.pending === null || e.pending === undefined ? '—' : e.pending ? 'yes' : 'no') },
  ]

  // Freeze-frame data: show the most recent record only, other records stay in the API.
  const latestRecord = snaps.data?.[0]
  const latestSignals = (snaps.data ?? []).filter(
    (s) => s.transaction_id === latestRecord?.transaction_id && s.record_number === latestRecord?.record_number,
  )

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
              <BarChart data={[...(readouts.data ?? [])].reverse().map((r) => ({ t: ts(r.event_at), faults: r.faults, 'read errors': r.read_errors }))}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} minTickGap={36} {...axis} />
                <YAxis {...axis} width={30} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'var(--grid)' }} content={<ChartTip fmtLabel={(v) => fmtDateTime(new Date(Number(v)).toISOString())} />} />
                <Bar dataKey="faults" stackId="r" fill="var(--accent)" />
                <Bar dataKey="read errors" stackId="r" fill="var(--steel)" />
              </BarChart>
            </ResponsiveContainer>
          </QueryState>
        </Panel>
      </div>

      {sel && (
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          <Panel title={`${sel.ecu} · ${sel.dtc_code}:${sel.failure_type}`} hint={sel.ecu_title ?? undefined}>
            <QueryState query={events}>
              <DataTable rows={events.data ?? []} columns={evCols} rowKey={(e) => `${e.transaction_id}`} />
            </QueryState>
          </Panel>
          <Panel title="Freeze frame" hint={latestRecord ? `record ${latestRecord.record_number} · ${fmtDateTime(latestRecord.snapshot_at)}` : 'none stored'}>
            <QueryState query={snaps}>
              {latestSignals.length === 0 ? (
                <div className="state">No snapshot data for this code</div>
              ) : (
                <dl className="kv">
                  {latestSignals.map((s) => (
                    <div key={s.signal} style={{ display: 'contents' }}>
                      <dt>{s.signal.replaceAll('_', ' ')}</dt>
                      <dd>{s.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </QueryState>
          </Panel>
        </div>
      )}
    </>
  )
}
