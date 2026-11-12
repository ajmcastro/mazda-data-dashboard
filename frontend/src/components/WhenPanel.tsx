import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useActivityPattern } from '../api/hooks'
import { ACTIVITY_NOTE, hourBars, hourLabel, summaryLine, weekdayBars } from '../activity'
import { ANIMATE, fmtNum } from '../lib'
import { Panel, QueryState } from './ui'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }

/** When the car is used: days with activity by hour of the day, and by weekday, per day (PLAN.md M35). */
export function WhenPanel() {
  const pattern = useActivityPattern()
  const hours = hourBars(pattern.data)
  const days = weekdayBars(pattern.data)
  const line = summaryLine(hours, days)

  return (
    <Panel title="When the car is used" hint={pattern.data ? `car time · ${pattern.data.time_zone}` : undefined}>
      <QueryState query={pattern}>
        {hours.length === 0 ? (
          <p className="muted">No warnings or drives in this period.</p>
        ) : (
          <>
            {line && <p style={{ margin: '0 0 10px' }}>{line}</p>}
            <div className="grid cols-2">
              <div>
                <div className="sub-h">DAYS WITH ACTIVITY, BY HOUR</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={hours} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" interval={2} tickLine={false} axisLine={false} {...axis} />
                    <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} {...axis} />
                    <Tooltip
                      cursor={{ fill: 'var(--grid)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload as (typeof hours)[number]
                        return (
                          <div className="chart-tip">
                            <div className="t">{hourLabel(d.hour)}</div>
                            <div className="row"><span>Days</span><span>{d.days}{d.few ? ' (few days)' : ''}</span></div>
                            <div className="row"><span>Different warnings</span><span>{d.codes}</span></div>
                            <div className="row"><span>Distance seen</span><span>{fmtNum(d.km, 0, 'km')}</span></div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="days" isAnimationActive={ANIMATE} radius={[3, 3, 0, 0]}>
                      {hours.map((h) => (
                        <Cell key={h.hour} fill="var(--accent)" fillOpacity={h.few ? 0.35 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="sub-h">SHARE OF EACH WEEKDAY WITH ACTIVITY</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="short" tickLine={false} axisLine={false} {...axis} />
                    <YAxis domain={[0, 100]} unit="%" width={46} tickLine={false} axisLine={false} {...axis} />
                    <Tooltip
                      cursor={{ fill: 'var(--grid)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload as (typeof days)[number]
                        return (
                          <div className="chart-tip">
                            <div className="t">{d.name}</div>
                            <div className="row"><span>Days with activity</span><span>{d.activeDays} of {d.calendarDays}{d.few ? ' (few days)' : ''}</span></div>
                            <div className="row"><span>Distance seen per day</span><span>{fmtNum(d.kmPerDay, 1, 'km')}</span></div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="pctOfDays" isAnimationActive={ANIMATE} radius={[3, 3, 0, 0]}>
                      {days.map((d) => (
                        <Cell key={d.weekday} fill="var(--accent)" fillOpacity={d.few ? 0.35 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>{ACTIVITY_NOTE}</p>
          </>
        )}
      </QueryState>
    </Panel>
  )
}
