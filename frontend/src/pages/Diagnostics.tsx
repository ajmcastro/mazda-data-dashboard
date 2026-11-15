import { t, tr } from '../i18n'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDiagCompare, useDiagFrames, useDiagHistory, useDiagReport, useDiagReports } from '../api/hooks'
import type { DiagDelta, ObdTest } from '../api/types'
import { ReportHistory } from '../components/ReportHistory'
import { Badge, DataTable, Panel, QueryState, Stat, type Column } from '../components/ui'
import { fmtDateTime, fmtNum, pickReport, reportLabel } from '../lib'
import { consumptionLabel, distanceLabel, fmtConsumption, fmtDistance } from '../units'

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
  // to the period, so a particular report can be bookmarked or linked to.
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
    { key: 'id', header: tr('Monitor'), render: (t) => <span className="mono">{t.obdmid}/{t.test}</span>, sort: (t) => t.obdmid + t.test },
    { key: 'ecu', header: tr('ECU'), render: (t) => t.ecu ?? '—' },
    { key: 'val', header: tr('Value'), num: true, render: (t) => `${fmtNum(t.value, 2)}${t.unit ? ` ${t.unit}` : ''}` },
    { key: 'range', header: tr('Limits'), num: true, render: (t) => `${fmtNum(t.min_value, 2)} … ${fmtNum(t.max_value, 2)}` },
    { key: 'pos', header: '', render: (t) => <RangeBar t={t} /> },
    { key: 'ok', header: tr('Result'), render: (t) => (t.in_range ? <Badge kind="ok">{tr('pass')}</Badge> : <Badge kind="critical">{tr('out of range')}</Badge>), sort: (t) => Number(t.in_range) },
  ]
  const deltaCols: Column<DiagDelta>[] = [
    { key: 'sec', header: tr('Section'), render: (d) => <span className="muted">{d.section}</span> },
    { key: 'key', header: tr('Value'), render: (d) => <span className="mono">{d.key}</span>, sort: (d) => d.key },
    { key: 'a', header: tr('Earlier report'), num: true, render: (d) => fmtNum(d.a, 2, d.unit ?? '') },
    { key: 'b', header: tr('Later report'), num: true, render: (d) => fmtNum(d.b, 2, d.unit ?? '') },
    { key: 'd', header: tr('Change'), num: true, sort: (d) => Math.abs(d.delta), render: (d) => (d.delta > 0 ? '+' : '') + fmtNum(d.delta, 2) },
  ]
  const deltas = (compare.data ?? []).filter((d) => !onlyChanged || d.delta !== 0)
  const failed = (r?.obd_tests ?? []).filter((t) => t.in_range === false).length
  const activeAes = (r?.aes ?? []).filter((a) => a.state && a.state !== 'Not Active').length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('page.diagnostics')}</h1>
          <p>
            {r
              ? tr('Diagnostic tool report from {date} at {distance}', { date: fmtDateTime(r.info.taken_at), distance: fmtDistance(r.info.odometer_km) })
              : tr('The diagnostic report from your Mazda data download.')}
          </p>
        </div>
        {list.length > 0 && (
          <div className="controls">
            <label>
              {tr('Report')}
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
                {tr('Compare with')}
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
          <b>{tr('That report is not in the database')}</b>
          <span className="muted">{tr('Showing the newest one instead.')}</span>
        </div>
      )}
      {list.length === 1 && (
        <div className="alert-row" role="status" style={{ marginBottom: 14 }}>
          <b>{tr('1 report loaded')}</b>
          <span className="muted">
            {tr('Put more diagnostic-tool')} <span className="mono">*diag-tool*.txt</span> {tr('files in')} <span className="mono">data/</span> {tr('and run')} <span className="mono">make ingest</span> {tr('to compare reports over time.')}
          </span>
        </div>
      )}

      <QueryState query={reports}>
        {list.length === 0 ? (
          <Panel>
            <div className="state">
              {tr('No diagnostic-tool report found. Put the tool\'s')} <span className="mono">*diag-tool*.txt</span> {tr('file in')} <span className="mono">data/</span> {tr('and run')} <span className="mono">make ingest</span>.
            </div>
          </Panel>
        ) : (
          <QueryState query={report}>
            {r && (
              <>
                <div className="grid cols-4">
                  <Stat label={tr('Lifetime economy')} value={fmtConsumption(s?.lifetime_l_per_100km, 2)} unit={consumptionLabel()} sub={tr('{litres} l over {distance}', { litres: fmtNum(s?.lifetime_fuel_l, 0), distance: `${fmtDistance(s?.lifetime_km, 0, false)} ${distanceLabel()}` })} />
                  <Stat label={tr('Since last reset')} value={fmtConsumption(s?.recent_l_per_100km, 2)} unit={consumptionLabel()} sub={tr('{litres} l over {distance}', { litres: fmtNum(s?.recent_fuel_l, 1), distance: `${fmtDistance(s?.recent_km, 0, false)} ${distanceLabel()}` })} />
                  <Stat label={tr('Engine running')} value={fmtNum(s?.engine_hours, 0)} unit="h" sub={tr('{n} ignition cycles', { n: fmtNum(s?.ignition_cycles) })} />
                  <Stat label={tr('Emission monitors')} value={`${r.obd_tests.length - failed}/${r.obd_tests.length}`} unit={tr('pass')} sub={tr('{n} of {total} AES active', { n: activeAes, total: r.aes.length })} alert={failed > 0} />
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
                      {tr('only changed values')}
                    </label>
                  }>
                    <QueryState query={compare}>
                      <DataTable rows={deltas} columns={deltaCols} rowKey={(d) => `${d.section}|${d.key}`} empty="No numeric value changed" />
                    </QueryState>
                  </Panel>
                )}

                <div className="grid split" style={{ marginTop: 14 }}>
                  <Panel title={tr('Emission monitors')} hint={tr('Mode 6 results; a value outside its limits is a failed test')}>
                    <DataTable rows={r.obd_tests} columns={obdCols} rowKey={(t) => `${t.ecu}|${t.obdmid}|${t.test}`} />
                  </Panel>
                  <Panel title={tr('Stored fault lists')} hint={tr('from the tool, per control unit')}>
                    <div className="stack">
                      {r.dtc_lists.map((g) => (
                        <div key={`${g.list_name}-${g.ecu}`}>
                          <div className="muted" style={{ marginBottom: 6 }}>
                            <b>{g.ecu}</b> · {g.list_name.replace('_', ' ')} · {g.dtcs.length}
                          </div>
                          <div className="chips">
                            {g.dtcs.map((d) => (
                              <span key={d.dtc_code + d.failure_type} className="chip" title={d.title ?? tr('no description yet')}>
                                {d.dtc_code}:{d.failure_type}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>

                <Panel title={tr('Counters')} hint={tr('engine and driving data stored in the engine control unit')}>
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

                <Panel title={tr('Freeze frames recorded by the tool')} hint={tr('state of the car when each fault was set')}>
                  <QueryState query={frames}>
                    <div className="sections">
                      {(frames.data ?? []).map((f) => (
                        <details key={`${f.ecu}-${f.dtc_code}-${f.record_number}`}>
                          <summary>
                            <span className="mono">{f.dtc_code}:{f.failure_type}</span> {tr('on {unit}', { unit: f.ecu ?? '' })}{' '}
                            <span className="muted mono">{tr('record {n}', { n: f.record_number ?? '' })}</span>
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
