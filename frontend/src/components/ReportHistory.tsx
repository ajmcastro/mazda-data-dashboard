import { tr } from '../i18n'
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { UseQueryResult } from '@tanstack/react-query'
import type { DiagHistoryPoint } from '../api/types'
import { ANIMATE, fmtDate, fmtNum, fmtTick, ts } from '../lib'
import { consumptionDigits, consumptionLabel, distanceLabel, fmtConsumption, fmtDistance, toConsumption } from '../units'
import { ChartTip, DataTable, Panel, QueryState, type Column } from './ui'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }

function Trend({ title, data, field, digits, selected }: {
  title: string
  data: DiagHistoryPoint[]
  field: 'lifetime_l_per_100km' | 'ignition_cycles'
  digits: number
  selected?: string
}) {
  const points = data.filter((p) => p.taken_at && p[field] !== null && p[field] !== undefined).map((p) => ({
    id: p.report_id,
    t: ts(p.taken_at!),
    v: p[field] as number,
  }))
  const picked = points.find((p) => p.id === selected)
  return (
    <div>
      <h3 className="sub-h">{title}</h3>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={points} margin={{ right: 18, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} minTickGap={50} {...axis} />
          <YAxis {...axis} width={44} domain={['auto', 'auto']} tickFormatter={(v) => fmtNum(v, digits)} />
          <Tooltip content={<ChartTip fmtLabel={(v) => fmtDate(new Date(Number(v)).toISOString())} />} />
          <Line isAnimationActive={ANIMATE} name={title} dataKey="v" stroke="var(--steel)" strokeWidth={2} dot={{ r: 4, fill: 'var(--steel)' }} />
          {picked && <ReferenceDot x={picked.t} y={picked.v} r={7} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** One row per diagnostic-tool report (oldest to newest in the charts, newest first in the table). */
export function ReportHistory({ query, selected, onSelect }: {
  query: UseQueryResult<DiagHistoryPoint[], Error>
  selected?: string
  onSelect: (reportId: string) => void
}) {
  const data = query.data ?? []
  const columns: Column<DiagHistoryPoint>[] = [
    { key: 'at', header: tr('Report'), sort: (p) => p.taken_at ?? '', render: (p) => <span title={p.source_file}>{fmtDate(p.taken_at)}</span> },
    { key: 'odo', header: tr('Odometer'), num: true, sort: (p) => p.odometer_km ?? 0, render: (p) => fmtDistance(p.odometer_km) },
    { key: 'km', header: `Lifetime ${distanceLabel()}`, num: true, sort: (p) => p.lifetime_km ?? 0, render: (p) => fmtDistance(p.lifetime_km, 0, false) },
    { key: 'eco', header: consumptionLabel(), num: true, sort: (p) => p.lifetime_l_per_100km ?? 0, render: (p) => fmtConsumption(p.lifetime_l_per_100km, 2) },
    { key: 'ign', header: tr('Ignitions'), num: true, sort: (p) => p.ignition_cycles ?? 0, render: (p) => fmtNum(p.ignition_cycles) },
    { key: 'h', header: tr('Engine h'), num: true, sort: (p) => p.engine_hours ?? 0, render: (p) => fmtNum(p.engine_hours, 0) },
    { key: 'mon', header: tr('Monitors'), num: true, render: (p) => `${p.monitors_passed}/${p.monitors_total}` },
    { key: 'dtc', header: tr('Faults listed'), num: true, sort: (p) => p.dtcs_listed, render: (p) => fmtNum(p.dtcs_listed) },
  ]
  return (
    <Panel title={tr('Report history')} hint={data.length > 1 ? tr('click a report to open it') : undefined}>
      <QueryState query={query}>
        <DataTable
          rows={[...data].reverse()}
          columns={columns}
          rowKey={(p) => p.report_id}
          selected={selected}
          onSelect={(p) => onSelect(p.report_id)}
        />
        {data.length > 1 && (
          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <Trend
              title={tr('Lifetime fuel economy ({unit})', { unit: consumptionLabel() })}
              data={data.map((p) => ({ ...p, lifetime_l_per_100km: toConsumption(p.lifetime_l_per_100km) }))}
              field="lifetime_l_per_100km"
              digits={consumptionDigits(2)}
              selected={selected}
            />
            <Trend title={tr('Ignition cycles')} data={data} field="ignition_cycles" digits={0} selected={selected} />
          </div>
        )}
      </QueryState>
    </Panel>
  )
}
