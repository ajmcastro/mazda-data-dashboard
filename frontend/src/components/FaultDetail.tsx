import { codeTitle } from '../alerttext'
import { tr } from '../i18n'
import { useMemo, useState } from 'react'
import { useDtcEvents, useFaultContext, useFreezeFrames, useSignalValues } from '../api/hooks'
import { meanings, valueText } from '../signals'
import type { DtcEvent, DtcFrequency, FreezeFrame } from '../api/types'
import { fmtDateTime, fmtDateTimeSec, fmtNum, signalLabel, signalValue } from '../lib'
import { fmtDistance } from '../units'
import { FrameSummary } from './FrameSummary'
import { ComebackPanel } from './ComebackPanel'
import { Badge, DataTable, Panel, QueryState, type Column } from './ui'

const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? tr('yes') : tr('no'))

// A DTC can have several stored records (frames); the record number and the seconds tell them apart.
const frameLabel = (f: FreezeFrame) =>
  `${tr('record {n}', { n: f.record_number ?? '' })} · ${f.snapshot_at ? fmtDateTimeSec(f.snapshot_at) : tr('unknown time')} · ${tr('reported {n}×', { n: f.times_reported })}`

/** Signals whose value is not the same in every frame: the interesting part when comparing. */
function differingSignals(frames: FreezeFrame[]): string[] {
  const values = new Map<string, Set<string | null | undefined>>()
  for (const f of frames) for (const s of f.signals) values.set(s.signal, (values.get(s.signal) ?? new Set()).add(s.value))
  return [...values].filter(([, v]) => v.size > 1).map(([k]) => k)
}

export function FaultDetail({ fault }: { fault: DtcFrequency }) {
  const events = useDtcEvents(fault.ecu, fault.dtc_code)
  const frames = useFreezeFrames(fault.ecu, fault.dtc_code)
  const [chosenTx, setChosenTx] = useState<string | undefined>()
  const [frameIdx, setFrameIdx] = useState(0)

  const tx = chosenTx ?? events.data?.[0]?.transaction_id
  const context = useFaultContext(tx)
  const documented = meanings(useSignalValues().data) // the engine state in words (M72)
  const list = useMemo(() => frames.data ?? [], [frames.data])
  const frame = list[Math.min(frameIdx, Math.max(0, list.length - 1))]
  const varying = useMemo(() => differingSignals(list), [list])
  const ctx = context.data

  const warningCounts = useMemo(() => {
    const counts = new Map<string, { title: string; n: number }>()
    for (const w of ctx?.warnings ?? []) {
      const c = counts.get(w.code) ?? { title: w.title, n: 0 }
      counts.set(w.code, { ...c, n: c.n + 1 })
    }
    return [...counts].sort((a, b) => b[1].n - a[1].n)
  }, [ctx])

  const evCols: Column<DtcEvent>[] = [
    { key: 'at', header: tr('Read-out'), render: (e) => fmtDateTime(e.event_at) },
    { key: 'odo', header: tr('Odometer'), num: true, render: (e) => fmtDistance(e.odometer_km) },
    { key: 'conf', header: tr('Confirmed'), render: (e) => yesNo(e.confirmed) },
    { key: 'pend', header: tr('Pending'), render: (e) => yesNo(e.pending) },
  ]

  return (
    <>
      <div style={{ marginTop: 14 }}>
        <FrameSummary fault={fault} />
      </div>
      <div style={{ marginTop: 14 }}>
        <ComebackPanel fault={fault} />
      </div>
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Panel title={`${fault.ecu} · ${fault.dtc_code}:${fault.failure_type}`} hint={tr('click a read-out to see what surrounded it')}>
          <QueryState query={events}>
            <DataTable
              rows={events.data ?? []}
              columns={evCols}
              rowKey={(e) => e.transaction_id}
              selected={tx}
              onSelect={(e) => setChosenTx(e.transaction_id)}
            />
          </QueryState>
        </Panel>

        <Panel
          title={tr('Freeze frame')}
          hint={
            list.length > 1 ? (
              <select aria-label={tr('Freeze frame')} value={frameIdx} onChange={(e) => setFrameIdx(Number(e.target.value))}>
                {list.map((f, i) => (
                  <option key={f.frame_id} value={i}>{frameLabel(f)}</option>
                ))}
              </select>
            ) : frame ? (
              frameLabel(frame)
            ) : (
              tr('none stored')
            )
          }
        >
          <QueryState query={frames}>
            {!frame ? (
              <div className="state">{tr('The car stored no freeze frame for this code')}</div>
            ) : (
              <dl className="kv">
                {frame.signals.map((s) => (
                  <div key={s.signal} style={{ display: 'contents' }}>
                    <dt>{signalLabel(s.signal)}</dt>
                    <dd>{signalValue(s.signal, s.value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </QueryState>
        </Panel>
      </div>

      {list.length > 1 && varying.length > 0 && (
        <Panel title={tr('What changed between frames')} hint={tr('{n} frames, signals that differ', { n: list.length })}>
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th>{tr('Signal')}</th>
                  {list.map((f) => (
                    <th key={f.frame_id} className="num" title={frameLabel(f)}>
                      {tr('rec {n}', { n: f.record_number ?? '' })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {varying.map((sig) => (
                  <tr key={sig}>
                    <td>{signalLabel(sig)}</td>
                    {list.map((f) => (
                      <td key={f.frame_id} className="num">
                        {signalValue(sig, f.signals.find((s) => s.signal === sig)?.value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {tx && (
        <Panel title={tr('Around this fault')} hint={ctx ? `${fmtDateTime(ctx.event_at)} · ±${ctx.window_hours} h` : undefined}>
          <QueryState query={context}>
            {ctx && (
              <div className="grid cols-3">
                <div>
                  <h3 className="sub-h">{tr('Warnings nearby')}</h3>
                  {warningCounts.length === 0 ? (
                    <div className="muted">{tr('none in the window')}</div>
                  ) : (
                    <div className="chips">
                      {warningCounts.map(([code, c]) => (
                        <span key={code} className="chip" title={codeTitle(c.title)}>{code} ×{c.n}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="sub-h">{tr('Other faults in the same read-out')}</h3>
                  <div className="chips">
                    {ctx.other_faults.map((f) => (
                      <span key={f.ecu + f.dtc_code} className="chip" title={codeTitle(f.title)}>{f.ecu} {f.dtc_code}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="sub-h">{tr('Car status')}</h3>
                  {ctx.status ? (
                    <dl className="kv">
                      <dt>{tr('Snapshot')}</dt>
                      <dd>{tr('{n} min away', { n: fmtNum(ctx.status_offset_minutes) })}</dd>
                      <dt>{tr('Fuel')}</dt>
                      <dd>{fmtNum(ctx.status.fuel_level_pct, 0, '%')}</dd>
                      <dt>{tr('Odometer')}</dt>
                      <dd>{fmtDistance(ctx.status.odometer_km)}</dd>
                      <dt>{tr('Engine state')}</dt>
                      <dd>{valueText(documented, 'enginestate', ctx.status.engine_state)}</dd>
                    </dl>
                  ) : (
                    <div className="muted">
                      <Badge kind="dim">{tr('no snapshot')}</Badge> {tr('within 3 h')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </QueryState>
        </Panel>
      )}
    </>
  )
}
