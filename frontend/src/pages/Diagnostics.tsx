import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDiagCompare, useDiagFrames, useDiagHistory, useDiagReport, useDiagReports } from '../api/hooks'
import type { DiagDelta, ObdTest } from '../api/types'
import { ReportHistory } from '../components/ReportHistory'
import { Badge, DataTable, Panel, QueryState, Stat, type Column } from '../components/ui'
import { fmtDateTime, fmtNum, pickReport, reportLabel } from '../lib'

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
  const history = useDiagHistory()
  const [params, setParams] = useSearchParams()
  const [onlyChanged, setOnlyChanged] = useState(true)
  const list = reports.data ?? []

  // The shown report and the one to compare with live in the address (?report=…&compare=…), next
  // to the period, so a particular visit can be bookmarked or linked to.
  const { report: picked, notFound } = pickReport(list, params.get('report'))
  const id = picked?.report_id
  const compareWith = list.find((x) => x.report_id === params.get('compare') && x.report_id !== id)?.report_id
  const setParam = (key: 'report' | 'compare', value: string | undefined) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (value) p.set(key, value)
        else p.delete(key)
        return p
      },
      { replace: true },
    )

  const report = useDiagReport(id)
  const frames = useDiagFrames(id)
  const otherInfo = list.find((x) => x.report_id === compareWith)
  // always read the comparison in time order: from the earlier report to the later one
  const otherIsEarlier = (otherInfo?.taken_at ?? '') <= (picked?.taken_at ?? '')
  const earlierId = otherIsEarlier ? compareWith : id
  const laterId = otherIsEarlier ? id : compareWith
  const compare = useDiagCompare(earlierId, laterId)
  const earlierInfo = otherIsEarlier ? otherInfo : picked
  const laterInfo = otherIsEarlier ? picked : otherInfo

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
    { key: 'a', header: 'Earlier report', num: true, render: (d) => fmtNum(d.a, 2, d.unit ?? '') },
    { key: 'b', header: 'Later report', num: true, render: (d) => fmtNum(d.b, 2, d.unit ?? '') },
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
        {list.length > 0 && (
          <div className="controls">
            <label>
              Report
              <select
                className="report-select"
                value={id}
                onChange={(e) => setParam('report', e.target.value)}
              >
                {list.map((x) => (
                  <option key={x.report_id} value={x.report_id}>
                    {reportLabel(x)}
                  </option>
                ))}
              </select>
            </label>
            {list.length > 1 && (
              <label>
                Compare with
                <select
                  className="report-select"
                  value={compareWith ?? ''}
                  onChange={(e) => setParam('compare', e.target.value || undefined)}
                >
                  <option value="">—</option>
                  {list
                    .filter((x) => x.report_id !== id)
                    .map((x) => (
                      <option key={x.report_id} value={x.report_id}>
                        {reportLabel(x)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      {notFound && (
        <div className="alert-row warn" role="status" style={{ marginBottom: 14 }}>
          <b>That report is not in the database</b>
          <span className="muted">Showing the newest one instead.</span>
        </div>
      )}
      {list.length === 1 && (
        <div className="alert-row" role="status" style={{ marginBottom: 14 }}>
          <b>1 report loaded</b>
          <span className="muted">
            Put more diagnostic-tool <span className="mono">*diag-tool*.txt</span> files in <span className="mono">data/</span> and run <span className="mono">make ingest</span> to compare visits.
          </span>
        </div>
      )}

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

                <ReportHistory
                  query={history}
                  selected={id}
                  onSelect={(rid) => setParam('report', rid)}
                />

                {compareWith && (
                  <Panel title={`Change: ${fmtDateTime(earlierInfo?.taken_at)} → ${fmtDateTime(laterInfo?.taken_at)}`} hint={
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
