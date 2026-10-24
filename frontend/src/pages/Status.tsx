import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAlarms, useDoors, useOilService, useStatusTimeline, useTripSegments } from '../api/hooks'
import type { AlarmEvent, OilService, TripSegment } from '../api/types'
import { ChartTip, DataTable, Panel, QueryState, type Column } from '../components/ui'
import { ANIMATE, fmtDateTime, fmtNum, fmtTick, ts } from '../lib'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }
const tipLabel = (v: number | string) => fmtDateTime(new Date(Number(v)).toISOString())

/** Chart points: every step of the countdown, plus the latest reading so the line reaches it. */
function oilPoints(o: OilService) {
  const points = o.steps.map((s) => ({ t: ts(s.read_at), km: s.remaining_km }))
  if (o.read_at && o.remaining_km != null && ts(o.read_at) !== points.at(-1)?.t) {
    points.push({ t: ts(o.read_at), km: o.remaining_km })
  }
  return points
}

export default function Status() {
  const status = useStatusTimeline()
  const doors = useDoors(1)
  const alarms = useAlarms()
  const trips = useTripSegments(60)
  const oil = useOilService()

  const points = (status.data ?? []).map((s) => ({
    t: ts(s.created_at),
    'fuel %': s.fuel_level_pct ?? null,
    'range km': s.range_km ?? null,
    FL: s.tire_fl_kpa ?? null,
    FR: s.tire_fr_kpa ?? null,
    RL: s.tire_rl_kpa ?? null,
    RR: s.tire_rr_kpa ?? null,
  }))

  const tripCols: Column<TripSegment>[] = [
    { key: 'end', header: 'Ended', sort: (t) => t.end_at, render: (t) => fmtDateTime(t.end_at) },
    { key: 'km', header: 'Distance', num: true, sort: (t) => t.km, render: (t) => fmtNum(t.km, 1, 'km') },
    { key: 'fuel', header: 'Fuel', num: true, sort: (t) => t.fuel_l, render: (t) => fmtNum(Math.max(0, t.fuel_l), 2, 'l') },
    { key: 'cons', header: 'l/100 km', num: true, sort: (t) => t.l_per_100km ?? -1, render: (t) => fmtNum(t.l_per_100km, 1) },
    { key: 'gap', header: 'Gap', num: true, render: (t) => fmtNum(t.gap_hours, 1, 'h') },
  ]
  const alarmCols: Column<AlarmEvent>[] = [
    { key: 'at', header: 'When', render: (a) => fmtDateTime(a.created_at) },
    { key: 'st', header: 'Burglar status', num: true, render: (a) => fmtNum(a.burglar_status) },
    { key: 'rs', header: 'Reason', num: true, render: (a) => fmtNum(a.alarm_reason) },
  ]
  const d = doors.data?.[0]
  const doorRows: [string, number | null | undefined][] = d
    ? [
        ['Driver door', d.door_driver], ['Passenger door', d.door_passenger],
        ['Rear left', d.door_rear_left], ['Rear right', d.door_rear_right],
        ['Trunk', d.trunk], ['Hood', d.hood],
      ]
    : []

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Status</h1>
          <p>Fuel, tires, trips, doors and alarm history from the car's remote-status reports.</p>
        </div>
      </div>

      <div className="grid cols-2">
        <Panel title="Fuel level and range" hint="gauge % and estimated km">
          <QueryState query={status}>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={points}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} minTickGap={36} {...axis} />
                <YAxis yAxisId="l" {...axis} width={34} domain={[0, 100]} />
                <YAxis yAxisId="r" orientation="right" {...axis} width={40} />
                <Tooltip content={<ChartTip fmtLabel={tipLabel} />} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--mono)' }} />
                <Line isAnimationActive={ANIMATE} yAxisId="l" name="fuel %" dataKey="fuel %" stroke="var(--teal)" dot={false} strokeWidth={2} connectNulls />
                <Line isAnimationActive={ANIMATE} yAxisId="r" name="range km" dataKey="range km" stroke="var(--steel)" dot={false} strokeWidth={1.5} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </QueryState>
        </Panel>

        <Panel title="Tire pressure" hint="kPa per wheel">
          <QueryState query={status}>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={points}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} minTickGap={36} {...axis} />
                <YAxis {...axis} width={40} domain={['dataMin - 10', 'dataMax + 10']} />
                <Tooltip content={<ChartTip fmtLabel={tipLabel} />} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--mono)' }} />
                <Line isAnimationActive={ANIMATE} name="front left" dataKey="FL" stroke="var(--accent)" dot={false} connectNulls />
                <Line isAnimationActive={ANIMATE} name="front right" dataKey="FR" stroke="var(--amber)" dot={false} connectNulls />
                <Line isAnimationActive={ANIMATE} name="rear left" dataKey="RL" stroke="var(--teal)" dot={false} connectNulls />
                <Line isAnimationActive={ANIMATE} name="rear right" dataKey="RR" stroke="var(--steel)" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </QueryState>
        </Panel>
      </div>

      {oil.data?.has_data && (
        <Panel title="Oil change countdown" hint="km left until the next oil change, as the car reports it">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={oilPoints(oil.data)} margin={{ right: 18, top: 5 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} minTickGap={36} {...axis} />
              <YAxis {...axis} width={44} domain={[0, 'auto']} />
              <Tooltip content={<ChartTip fmtLabel={tipLabel} />} />
              <Line isAnimationActive={ANIMATE} type="stepAfter" name="km left" dataKey="km" stroke="var(--amber)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            This is the car's own countdown, not a calculation. It moves in steps of 1,000 km or more, and a jump
            up means the oil was changed ({oil.data.intervals} service interval{oil.data.intervals === 1 ? '' : 's'} in the data).
          </p>
        </Panel>
      )}

      <div className="grid trips" style={{ marginTop: 14 }}>
        <Panel title="Recent trips" hint="between status snapshots">
          <QueryState query={trips}>
            <DataTable rows={trips.data ?? []} columns={tripCols} rowKey={(t) => t.end_at} />
          </QueryState>
        </Panel>
        <Panel title="Doors" hint={d ? fmtDateTime(d.created_at) : ''}>
          <QueryState query={doors}>
            <dl className="kv">
              {doorRows.map(([name, v]) => (
                <div key={name} style={{ display: 'contents' }}>
                  <dt>{name}</dt>
                  <dd>{v === null || v === undefined ? 'unknown' : v === 0 ? 'closed' : `open (${v})`}</dd>
                </div>
              ))}
              {d && (
                <>
                  <dt>Locks (driver / passenger)</dt>
                  <dd>{fmtNum(d.lock_driver)} / {fmtNum(d.lock_passenger)}</dd>
                  <dt>Invalid signals</dt>
                  <dd>{d.invalid_signals}</dd>
                </>
              )}
            </dl>
            <p className="muted" style={{ fontSize: 11 }}>Door value 0 is assumed to mean closed; lock codes are shown raw.</p>
          </QueryState>
        </Panel>
        <Panel title="Alarm history">
          <QueryState query={alarms}>
            <DataTable rows={alarms.data ?? []} columns={alarmCols} rowKey={(a) => a.created_at} />
          </QueryState>
        </Panel>
      </div>
    </>
  )
}
