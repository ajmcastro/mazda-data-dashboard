import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useCarWarnings, useFuelMonthly, useOdometerDaily, useOilService, useOverview } from '../api/hooks'
import { RangeLink } from '../components/RangeLink'
import { Odometer } from '../components/Odometer'
import { Tires } from '../components/Tires'
import { ChartTip, Panel, QueryState, Stat } from '../components/ui'
import { ANIMATE, carWarningHeadline, fmtAgo, fmtDate, fmtDateTime, fmtNum, fmtTick, oilTile, ts } from '../lib'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }

export default function OverviewPage() {
  const overview = useOverview()
  const odometer = useOdometerDaily()
  const fuel = useFuelMonthly()
  const oil = oilTile(useOilService().data)
  const carWarning = carWarningHeadline(useCarWarnings().data?.flags)
  const o = overview.data

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {o
              ? `Data from ${fmtDate(o.data_from)} to ${fmtDate(o.data_to)} · last reading ${fmtAgo(o.data_to)} · ${fmtNum(o.warnings_in_range)} warning events in this period`
              : 'Loading…'}
          </p>
        </div>
      </div>

      <QueryState query={overview}>
        {o && (
          <>
            <div className="alerts">
              {o.alerts_new > 0 && (
                <RangeLink to="/alerts" className="alert-row warn">
                  <b>{o.alerts_new} new alert{o.alerts_new > 1 ? 's' : ''}</b>
                  <span className="muted">Review and acknowledge</span>
                </RangeLink>
              )}
              {o.active_faults > 0 ? (
                <RangeLink to="/faults" className="alert-row bad">
                  <b>{o.active_faults} fault{o.active_faults > 1 ? 's' : ''} still listed in the latest read-out</b>
                  <span className="muted">Open the fault explorer</span>
                </RangeLink>
              ) : (
                <div className="alert-row ok"><b>No active faults in the latest read-out</b></div>
              )}
              {carWarning && (
                <RangeLink to="/status" className="alert-row bad">
                  <b>{carWarning}</b>
                  <span className="muted">The car's own warning flag: open Status</span>
                </RangeLink>
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
                  <div className="sub">{o.odometer_at ? `as of ${fmtDateTime(o.odometer_at)}` : 'no reading in this period'}</div>
                </div>
              </Panel>
              <Stat
                label="Distance driven"
                value={fmtNum(o.km_in_range)}
                unit="km"
                sub={`${fmtDate(o.range_from)} – ${fmtDate(o.range_to)}`}
              />
              <Stat
                label="Fuel economy"
                value={fmtNum(o.l_per_100km_in_range, 1)}
                unit="l/100 km"
                sub={`in this period · lifetime ${fmtNum(o.lifetime_l_per_100km, 1)}`}
              />
              <Stat
                label="Fuel level"
                value={fmtNum(o.status.fuel_level_pct)}
                unit="%"
                sub={`range ≈ ${fmtNum(o.status.range_km)} km`}
                alert={(o.status.fuel_level_pct ?? 100) < 15}
              />
              {oil && (
                <div className="oil-tile">
                  <Stat label="Next oil change" value={oil.value} unit="km left" sub={oil.sub} alert={oil.soon} />
                </div>
              )}
            </div>
          </>
        )}
      </QueryState>

      <div className="grid split" style={{ marginTop: 14 }}>
        <Panel title="Distance" hint="odometer, daily maximum">
          <QueryState query={odometer}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart margin={{ right: 18, top: 5 }} data={(odometer.data ?? []).map((d) => ({ t: ts(`${d.day}T00:00:00Z`), km: d.odometer_km }))}>
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
                <Area isAnimationActive={ANIMATE} name="km" dataKey="km" stroke="var(--accent)" strokeWidth={2} fill="url(#odo)" />
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
            <BarChart margin={{ right: 18, top: 5 }} data={fuel.data ?? []}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" {...axis} />
              <YAxis {...axis} width={34} domain={[0, 'auto']} />
              <Tooltip cursor={{ fill: 'var(--grid)' }} content={<ChartTip fmtLabel={String} />} />
              <Bar isAnimationActive={ANIMATE} name="l/100 km" dataKey="l_per_100km" fill="var(--teal)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </QueryState>
      </Panel>
    </>
  )
}
