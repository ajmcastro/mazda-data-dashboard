import { t, tr, trn } from '../i18n'
import { useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useCarWarnings, useFuelMonthly, useOdometerDaily, useOilService, useOverview, useRefuels, useImports, useSignalValues, useWritable } from '../api/hooks'
import { alarmText, meanings } from '../signals'
import { AheadPanel } from '../components/AheadPanel'
import { SEEN_KEY, changedAnything, headline } from '../imports'
import { lastFillUp } from '../refuels'
import { RangeLink } from '../components/RangeLink'
import { Odometer } from '../components/Odometer'
import { Tires } from '../components/Tires'
import { useCurrentModel } from '../model'
import { ChartTip, Panel, QueryState, Stat } from '../components/ui'
import { ANIMATE, carWarningHeadline, fmtAgo, fmtDate, fmtDateTime, fmtNum, fmtTick, oilTile, tireMeasuredNote, ts } from '../lib'
import { consumptionLabel, distanceLabel, fmtConsumption, fmtDistance, per100Label, toConsumption, toPer100 } from '../units'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }

export default function OverviewPage() {
  const { id } = useCurrentModel()
  const overview = useOverview()
  const documented = meanings(useSignalValues().data)
  const odometer = useOdometerDaily()
  const fuel = useFuelMonthly()
  const oil = oilTile(useOilService().data)
  const filled = lastFillUp(useRefuels().data)
  // the newest load made from the Import page, shown until dismissed (the Mac only)
  const lastImport = useImports(useWritable()).data?.[0]
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY)
    } catch {
      return null
    }
  })
  const dismiss = (at: string) => {
    try {
      localStorage.setItem(SEEN_KEY, at)
    } catch {
      /* private mode: dismissed for this visit only */
    }
    setSeen(at)
  }
  const carWarning = carWarningHeadline(useCarWarnings().data?.flags)
  const o = overview.data
  const tireNote = tireMeasuredNote(o?.status)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('page.overview')}</h1>
          <p>
            {o
              ? tr('Data from {from} to {to} · last reading {ago} · {n} warning events in this period', { from: fmtDate(o.data_from), to: fmtDate(o.data_to), ago: fmtAgo(o.data_to), n: fmtNum(o.warnings_in_range) })
              : tr('Loading…')}
          </p>
        </div>
      </div>

      <QueryState query={overview}>
        {o && (
          <>
            <div className="alerts">
              {lastImport && changedAnything(lastImport) && lastImport.imported_at !== seen && (
                <div className="alert-row ok">
                  <b>{headline(lastImport)}</b>
                  <RangeLink to="/import">{tr('What changed')}</RangeLink>
                  <button type="button" className="when" onClick={() => dismiss(lastImport.imported_at)}>{tr('Dismiss')}</button>
                </div>
              )}
              {o.alerts_new > 0 && (
                <RangeLink to="/alerts" className="alert-row warn">
                  <b>{trn('{n} new alert', '{n} new alerts', o.alerts_new)}</b>
                  <span className="muted">{tr('Review and acknowledge')}</span>
                </RangeLink>
              )}
              {o.active_faults > 0 ? (
                <RangeLink to="/faults" className="alert-row bad">
                  <b>{trn('{n} fault still listed in the latest read-out', '{n} faults still listed in the latest read-out', o.active_faults)}</b>
                  <span className="muted">{tr('Open the fault explorer')}</span>
                </RangeLink>
              ) : (
                <div className="alert-row ok"><b>{tr('No active faults in the latest read-out')}</b></div>
              )}
              {carWarning && (
                <RangeLink to="/status" className="alert-row bad">
                  <b>{carWarning}</b>
                  <span className="muted">{tr('The car\'s own warning flag: open Status')}</span>
                </RangeLink>
              )}
              {o.last_alarm && (
                <div className="alert-row warn">
                  <b>{tr('Burglar alarm event')}</b>
                  <span className="muted">{alarmText(documented, o.last_alarm.burglar_status, o.last_alarm.alarm_reason)}</span>
                  <span className="when">{fmtDateTime(o.last_alarm.created_at)}</span>
                </div>
              )}
              {o.unmapped_codes > 0 && (
                <div className="alert-row">
                  <b>{trn('{n} code has no description yet', '{n} codes have no description yet', o.unmapped_codes)}</b>
                  <span className="muted">{tr('Edit')} <span className="mono">config/models/{id}/codes/*.yaml</span> {tr('and run')} <span className="mono">make model</span></span>
                </div>
              )}
            </div>

            <div className="grid hero">
              <Panel>
                <div className="stat">
                  <div className="label">{tr('Odometer')}</div>
                  <div style={{ marginTop: 10 }}><Odometer km={o.odometer_km} /></div>
                  <div className="sub">{o.odometer_at ? tr('as of {when}', { when: fmtDateTime(o.odometer_at) }) : tr('no reading in this period')}</div>
                </div>
              </Panel>
              <Stat
                label={tr('Distance driven')}
                value={fmtDistance(o.km_in_range, 0, false)}
                unit={distanceLabel()}
                sub={`${fmtDate(o.range_from)} – ${fmtDate(o.range_to)}`}
              />
              <Stat
                label={tr('Fuel economy')}
                value={fmtConsumption(o.l_per_100km_in_range, 1)}
                unit={consumptionLabel()}
                sub={`${tr('in this period · lifetime {value}', { value: fmtConsumption(o.lifetime_l_per_100km, 1) })}${
                  o.cost_per_100km_in_range !== null && o.cost_per_100km_in_range !== undefined && o.currency
                    ? ` · ${tr('about {cost} {currency} per {distance} (estimate)', { cost: fmtNum(toPer100(o.cost_per_100km_in_range), 2), currency: o.currency, distance: per100Label() })}`
                    : ''
                }`}
              />
              <Stat
                label={tr('Fuel level')}
                value={fmtNum(o.status.fuel_level_pct)}
                unit="%"
                sub={`${tr('range ≈ {distance}', { distance: `${fmtDistance(o.status.range_km, 0, false)} ${distanceLabel()}` })}${filled ? ` · ${filled}` : ''}`}
                alert={(o.status.fuel_level_pct ?? 100) < 15}
              />
              {oil && (
                <div className="oil-tile">
                  <Stat label={tr('Next oil change')} value={oil.value} unit={tr('{unit} left', { unit: distanceLabel() })} sub={oil.sub} alert={oil.soon} />
                </div>
              )}
            </div>
          </>
        )}
      </QueryState>

      <div style={{ marginTop: 14 }}>
        <AheadPanel />
      </div>

      <div className="grid split" style={{ marginTop: 14 }}>
        <Panel title={tr('Distance')} hint={tr('odometer, daily maximum')}>
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

        <Panel title={tr('Tire pressure')} hint={o?.status.at ? tr('snapshot {when}', { when: fmtDateTime(o.status.at) }) : ''}>
          {o && <Tires fl={o.status.tire_fl_kpa} fr={o.status.tire_fr_kpa} rl={o.status.tire_rl_kpa} rr={o.status.tire_rr_kpa} />}
          {tireNote && (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0', color: tireNote.stale ? 'var(--amber)' : undefined }}>
              {tireNote.text}
              {tireNote.stale && ` · ${tr('old: the car had not measured since')}`}
            </p>
          )}
        </Panel>
      </div>

      <Panel title={tr('Fuel economy by month')} hint={tr("{unit}, from the car's trip counters", { unit: consumptionLabel() })}>
        <QueryState query={fuel}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart margin={{ right: 18, top: 5 }} data={(fuel.data ?? []).map((m) => ({ ...m, l_per_100km: toConsumption(m.l_per_100km) }))}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" {...axis} />
              <YAxis {...axis} width={34} domain={[0, 'auto']} />
              <Tooltip cursor={{ fill: 'var(--grid)' }} content={<ChartTip fmtLabel={String} />} />
              <Bar isAnimationActive={ANIMATE} name={consumptionLabel()} dataKey="l_per_100km" fill="var(--teal)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </QueryState>
      </Panel>
    </>
  )
}
