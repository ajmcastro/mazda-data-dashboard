import { useState } from 'react'
import { useDiagCompare, useDiagFrames, useDiagReport, useDiagReports } from '../api/hooks'
import type { DiagDelta, ObdTest } from '../api/types'
import { Badge, DataTable, Panel, QueryState, Stat, type Column } from '../components/ui'
import { fmtDateTime, fmtNum } from '../lib'

function RangeBar({ t }: { t: ObdTest }) {
  const pos = t.position === null || t.position === undefined ? null : Math.min(1, Math.max(0, t.position))
  return (
    <div className="range" title={`${t.min_value} … ${t.max_value}`}>
      <i style={{ left: `${(pos ?? 0.5) * 100}%` }} className={t.in_range ? '' : 'out'} />
    </div>
  )
}

export default function Diagnostics() {
  const reports = useDiagReports()
  const [chosen, setChosen] = useState<string | undefined>()
  const [other, setOther] = useState<string | undefined>()
  const [onlyChanged, setOnlyChanged] = useState(true)
  const list = reports.data ?? []
  const id = chosen ?? list[0]?.report_id
  const report = useDiagReport(id)
  const frames = useDiagFrames(id)
  const compare = useDiagCompare(other && other !== id ? other : undefined, id)

  // a comparison target equal to the shown report makes no sense, so it is ignored
  const compareWith = other && other !== id ? other : undefined

  const r = report.data
  const s = r?.summary

  const obdCols: Column<ObdTest>[] = [
    { key: 'id', header: 'Monitor', render: (t) => <span className="mono">{t.obdmid}/{t.test}</span>, sort: (t) => t.obdmid + t.test },
    { key: 'ecu', header: 'ECU', render: (t) => t.ecu ?? '—' },
    { key: 'val', header: 'Value', num: true, render: (t) => `${fmtNum(t.value, 2)}${t.unit ? ` ${t.unit}` : ''}` },
    { key: 'range', header: 'Limits', num: true, render: (t) => `${fmtNum(t.min_value, 2)} … ${fmtNum(t.max_value, 2)}` },
    { key: 'pos', header: '', render: (t) => <RangeBar t={t} /> },
    { key: 'ok', header: 'Result', render: (t) => (t.in_range ? <Badge kind="ok">pass</Badge> : <Badge kind="critical">out of range</Badge>), sort: (t) => Number(t.in_range) },
  ]
  const deltaCols: Column<DiagDelta>[] = [
    { key: 'sec', header: 'Section', render: (d) => <span className="muted">{d.section}</span> },
    { key: 'key', header: 'Value', render: (d) => <span className="mono">{d.key}</span>, sort: (d) => d.key },
    { key: 'a', header: 'Earlier', num: true, render: (d) => fmtNum(d.a, 2, d.unit ?? '') },
    { key: 'b', header: 'This report', num: true, render: (d) => fmtNum(d.b, 2, d.unit ?? '') },
    { key: 'd', header: 'Change', num: true, sort: (d) => Math.abs(d.delta), render: (d) => (d.delta > 0 ? '+' : '') + fmtNum(d.delta, 2) },
  ]
  const deltas = (compare.data ?? []).filter((d) => !onlyChanged || d.delta !== 0)
  const failed = (r?.obd_tests ?? []).filter((t) => t.in_range === false).length
  const activeAes = (r?.aes ?? []).filter((a) => a.state && a.state !== 'Not Active').length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Diagnostics</h1>
          <p>
            {r
              ? `Diagnostic tool report from ${fmtDateTime(r.info.taken_at)} at ${fmtNum(r.info.odometer_km, 0, 'km')}`
              : 'Dump from the dealer or workshop diagnostic tool.'}
          </p>
        </div>
        {list.length > 1 && (
          <div className="controls">
            <label>
              Report
              <select value={id} onChange={(e) => setChosen(e.target.value)}>
                {list.map((x) => (
                  <option key={x.report_id} value={x.report_id}>{fmtDateTime(x.taken_at)}</option>
                ))}
              </select>
            </label>
            <label>
              Compare with
              <select value={compareWith ?? ''} onChange={(e) => setOther(e.target.value || undefined)}>
                <option value="">—</option>
                {list.filter((x) => x.report_id !== id).map((x) => (
                  <option key={x.report_id} value={x.report_id}>{fmtDateTime(x.taken_at)}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <QueryState query={reports}>
        {list.length === 0 ? (
          <Panel>
            <div className="state">
              No diagnostic-tool report found. Put the tool's <span className="mono">*diag-tool*.txt</span> file in <span className="mono">data/</span> and run <span className="mono">make ingest</span>.
            </div>
          </Panel>
        ) : (
          <QueryState query={report}>
            {r && (
              <>
                <div className="grid cols-4">
                  <Stat label="Lifetime economy" value={fmtNum(s?.lifetime_l_per_100km, 2)} unit="l/100 km" sub={`${fmtNum(s?.lifetime_fuel_l, 0)} l over ${fmtNum(s?.lifetime_km, 0)} km`} />
                  <Stat label="Since last reset" value={fmtNum(s?.recent_l_per_100km, 2)} unit="l/100 km" sub={`${fmtNum(s?.recent_fuel_l, 1)} l over ${fmtNum(s?.recent_km, 0)} km`} />
                  <Stat label="Engine running" value={fmtNum(s?.engine_hours, 0)} unit="h" sub={`${fmtNum(s?.ignition_cycles)} ignition cycles`} />
                  <Stat label="Emission monitors" value={`${r.obd_tests.length - failed}/${r.obd_tests.length}`} unit="pass" sub={`${activeAes} of ${r.aes.length} AES active`} alert={failed > 0} />
                </div>

                {compareWith && (
                  <Panel title="Change since the earlier report" hint={
                    <label className="toggle">
                      <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
                      only changed values
                    </label>
                  }>
                    <QueryState query={compare}>
                      <DataTable rows={deltas} columns={deltaCols} rowKey={(d) => `${d.section}|${d.key}`} empty="No numeric value changed" />
                    </QueryState>
                  </Panel>
                )}

                <div className="grid split" style={{ marginTop: 14 }}>
                  <Panel title="Emission monitors" hint="Mode 6 results; a value outside its limits is a failed test">
                    <DataTable rows={r.obd_tests} columns={obdCols} rowKey={(t) => `${t.ecu}|${t.obdmid}|${t.test}`} />
                  </Panel>
                  <Panel title="Stored fault lists" hint="from the tool, per control unit">
                    <div className="stack">
                      {r.dtc_lists.map((g) => (
                        <div key={`${g.list_name}-${g.ecu}`}>
                          <div className="muted" style={{ marginBottom: 6 }}>
                            <b>{g.ecu}</b> · {g.list_name.replace('_', ' ')} · {g.dtcs.length}
                          </div>
                          <div className="chips">
                            {g.dtcs.map((d) => (
                              <span key={d.dtc_code + d.failure_type} className="chip" title={d.title ?? 'no description yet'}>
                                {d.dtc_code}:{d.failure_type}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>

                <Panel title="Counters" hint="engine and driving data stored in the engine control unit">
                  <div className="sections">
                    {r.sections
                      .filter((sec) => sec.items.length > 0)
                      .map((sec, i) => (
                        <details key={`${sec.ecu}-${sec.name}`} open={i === 2 || i === 3}>
                          <summary>
                            {sec.name} <span className="muted mono">{sec.ecu} · {sec.items.length}</span>
                          </summary>
                          <dl className="kv">
                            {sec.items.map((it) => (
                              <div key={it.key} style={{ display: 'contents' }}>
                                <dt className="mono">{it.key}</dt>
                                <dd>{it.value_num === null || it.value_num === undefined ? (it.value ?? 'n/a') : it.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ))}
                  </div>
                </Panel>

                <Panel title="Freeze frames recorded by the tool" hint="state of the car when each fault was set">
                  <QueryState query={frames}>
                    <div className="sections">
                      {(frames.data ?? []).map((f) => (
                        <details key={`${f.ecu}-${f.dtc_code}-${f.record_number}`}>
                          <summary>
                            <span className="mono">{f.dtc_code}:{f.failure_type}</span> on {f.ecu}{' '}
                            <span className="muted mono">record {f.record_number}</span>
                          </summary>
                          <dl className="kv">
                            {f.signals.map((sig) => (
                              <div key={sig.key} style={{ display: 'contents' }}>
                                <dt className="mono">{sig.key}</dt>
                                <dd>{sig.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ))}
                    </div>
                  </QueryState>
                </Panel>
              </>
            )}
          </QueryState>
        )}
      </QueryState>
    </>
  )
}
