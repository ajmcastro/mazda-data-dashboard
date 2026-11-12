import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useOccupancy } from '../api/hooks'
import { OCCUPANCY_NOTE, monthBars, shares, summaryLine } from '../occupancy'
import { ANIMATE } from '../lib'
import { Panel, QueryState } from './ui'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }

/** Who rides, from the seat belts (PLAN.md M37). Hidden when the car does not send the belts. */
export function WhoRidesPanel() {
  const occupancy = useOccupancy()
  const o = occupancy.data
  if (o && !o.available) return null
  const bars = monthBars(o)
  const line = summaryLine(o)
  return (
    <Panel title="Who rides" hint="from the seat belts">
      <QueryState query={occupancy}>
        {o && (
          <>
            {line && <p style={{ margin: '0 0 10px' }}>{line}</p>}
            <div className="grid cols-2">
              <div>
                <div className="sub-h">SHARE OF SNAPSHOTS WITH THE DRIVER BELTED</div>
                <dl className="kv">
                  {shares(o).map((s) => (
                    <div key={s.key} style={{ display: 'contents' }}>
                      <dt>{s.label}</dt>
                      <dd>{s.pct === null ? '—' : `${s.pct}%`} <span className="muted">({s.readings})</span></dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <div className="sub-h">FRONT PASSENGER BELTED, BY MONTH</div>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={bars} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} tickLine={false} axisLine={false} {...axis} />
                    <YAxis domain={[0, 100]} unit="%" width={46} tickLine={false} axisLine={false} {...axis} />
                    <Tooltip
                      cursor={{ fill: 'var(--grid)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload as (typeof bars)[number]
                        return (
                          <div className="chart-tip">
                            <div className="t">{d.month}</div>
                            <div className="row"><span>Front passenger</span><span>{d.passengerPct ?? '—'}%</span></div>
                            <div className="row"><span>A rear seat</span><span>{d.rearPct ?? '—'}%</span></div>
                            <div className="row"><span>Snapshots</span><span>{d.belted}{d.few ? ' (few)' : ''}</span></div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="passengerPct" isAnimationActive={ANIMATE} radius={[3, 3, 0, 0]}>
                      {bars.map((b) => (
                        <Cell key={b.month} fill="var(--accent)" fillOpacity={b.few ? 0.35 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>{OCCUPANCY_NOTE}</p>
          </>
        )}
      </QueryState>
    </Panel>
  )
}
