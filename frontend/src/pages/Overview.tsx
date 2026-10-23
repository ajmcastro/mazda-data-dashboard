import { Link } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useFuelMonthly, useOdometerDaily, useOverview } from '../api/hooks'
import { Odometer } from '../components/Odometer'
import { Tires } from '../components/Tires'
import { ChartTip, Panel, QueryState, Stat } from '../components/ui'
import { fmtAgo, fmtDate, fmtDateTime, fmtNum, fmtTick, ts } from '../lib'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }

export default function OverviewPage() {
  const overview = useOverview()
  const odometer = useOdometerDaily()
  const fuel = useFuelMonthly()
  const o = overview.data

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {o ? `Data from ${fmtDate(o.data_from)} to ${fmtDate(o.data_to)} · last reading ${fmtAgo(o.data_to)}` : 'Loading…'}
          </p>
        </div>
      </div>

      <QueryState query={overview}>
        {o && (
          <>
            <div className="alerts">
              {o.alerts_new > 0 && (
                <Link to="/alerts" className="alert-row warn">
                  <b>{o.alerts_new} new alert{o.alerts_new > 1 ? 's' : ''}</b>
                  <span className="muted">Review and acknowledge</span>
                </Link>
              )}
              {o.active_faults > 0 ? (
                <Link to="/faults" className="alert-row bad">
                  <b>{o.active_faults} fault{o.active_faults > 1 ? 's' : ''} still listed in the latest read-out</b>
                  <span className="muted">Open the fault explorer</span>
                </Link>
              ) : (
                <div className="alert-row ok"><b>No active faults in the latest read-out</b></div>
              )}
              {o.last_alarm && (
                <div className="alert-row warn">
                  <b>Burglar alarm event</b>
                  <span className="muted">status {o.last_alarm.burglar_status}, reason {o.last_alarm.alarm_reason}</span>
                  <span className="when">{fmtDateTime(o.last_alarm.created_at)}</span>
                </div>
              )}
              {o.unmapped_codes > 0 && (
                <div className="alert-row">
                  <b>{o.unmapped_codes} codes have no description yet</b>
                  <span className="muted">Edit <span className="mono">config/codes/*.yaml</span> and run <span className="mono">make model</span></span>
                </div>
              )}
            </div>

            <div className="grid hero">
              <Panel>
                <div className="stat">
                  <div className="label">Odometer</div>
                  <div style={{ marginTop: 10 }}><Odometer km={o.odometer_km} /></div>
                  <div className="sub">as of {fmtDateTime(o.odometer_at)}</div>
                </div>
              </Panel>
              <Stat label="Last 30 days" value={fmtNum(o.km_last_30_days)} unit="km" sub="distance driven" />
              <Stat
                label="Fuel economy"
                value={fmtNum(o.recent_l_per_100km, 1)}
                unit="l/100 km"
                sub={`this month · lifetime ${fmtNum(o.lifetime_l_per_100km, 1)}`}
              />
              <Stat
                label="Fuel level"
                value={fmtNum(o.status.fuel_level_pct)}
                unit="%"
                sub={`range ≈ ${fmtNum(o.status.range_km)} km`}
                alert={(o.status.fuel_level_pct ?? 100) < 15}
              />
            </div>
          </>
        )}
      </QueryState>

      <div className="grid split" style={{ marginTop: 14 }}>
        <Panel title="Distance" hint="odometer, daily maximum">
          <QueryState query={odometer}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={(odometer.data ?? []).map((d) => ({ t: ts(`${d.day}T00:00:00Z`), km: d.odometer_km }))}>
                <defs>
                  <linearGradient id="odo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} minTickGap={36} {...axis} />
                <YAxis {...axis} width={44} />
                <Tooltip content={<ChartTip fmtLabel={(v) => fmtDate(new Date(Number(v)).toISOString())} />} />
                <Area name="km" dataKey="km" stroke="var(--accent)" strokeWidth={2} fill="url(#odo)" />
              </AreaChart>
            </ResponsiveContainer>
          </QueryState>
        </Panel>

        <Panel title="Tire pressure" hint={o?.status.at ? fmtDateTime(o.status.at) : ''}>
          {o && <Tires fl={o.status.tire_fl_kpa} fr={o.status.tire_fr_kpa} rl={o.status.tire_rl_kpa} rr={o.status.tire_rr_kpa} />}
        </Panel>
      </div>

      <Panel title="Fuel economy by month" hint="l/100 km, from the car's trip counters">
        <QueryState query={fuel}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={fuel.data ?? []}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" {...axis} />
              <YAxis {...axis} width={34} domain={[0, 'auto']} />
              <Tooltip cursor={{ fill: 'var(--grid)' }} content={<ChartTip fmtLabel={String} />} />
              <Bar name="l/100 km" dataKey="l_per_100km" fill="var(--teal)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </QueryState>
      </Panel>
    </>
  )
}
