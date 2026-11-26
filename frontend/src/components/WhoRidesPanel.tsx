import { tr } from '../i18n'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useOccupancy } from '../api/hooks'
import { useCurrentModel } from '../model'
import { OCCUPANCY_NOTE, SEATS_NOTE, SENSORS_NOTE, monthBars, seatShade, seats, sensorRows, shares, summaryLine, type Seat } from '../occupancy'
import { ANIMATE } from '../lib'
import { Badge, Panel, QueryState } from './ui'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }

/** The cabin from above, front at the top: four seats, each shaded by how often its belt was buckled (M57). */
function SeatMap({ list }: { list: Seat[] }) {
  const [w, h, seat] = [150, 190, 46]
  const x = (s: Seat) => 22 + s.column * (w - 44 - seat)
  const y = (s: Seat) => 44 + s.row * 70
  return (
    <svg className="seat-map" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={tr('Seats from above: {list}', { list: list.map((s) => `${s.label} ${s.pct ?? 0}%`).join(', ') })}>
      <rect x={6} y={6} width={w - 12} height={h - 12} rx={34} className="seat-map-body" />
      <path d={`M 26 34 Q ${w / 2} 14 ${w - 26} 34`} className="seat-map-glass" />
      {list.map((s) => (
        <g key={s.id}>
          <title>{tr('{seat}: belted in {pct}% ({n} snapshots)', { seat: s.label, pct: s.pct ?? 0, n: s.readings })}</title>
          <rect x={x(s)} y={y(s)} width={seat} height={seat + 6} rx={9} className="seat-map-seat" style={{ fillOpacity: seatShade(s) }} />
          <text x={x(s) + seat / 2} y={y(s) + seat / 2 + 8} textAnchor="middle" className="seat-map-pct">{s.pct ?? 0}%</text>
        </g>
      ))}
    </svg>
  )
}

/** Who rides, from the seat belts (PLAN.md M37). Hidden when the car does not send the belts. */
export function WhoRidesPanel() {
  const occupancy = useOccupancy()
  const o = occupancy.data
  const steering = useCurrentModel().model?.body?.steering === 'right' ? 'right' : 'left'
  if (o && !o.available) return null
  const bars = monthBars(o)
  const line = summaryLine(o)
  const seatList = seats(o, steering)
  const sensors = sensorRows(o) // the seat sensors, where the platform documents them (M72)
  return (
    <Panel title={tr('Who rides')} hint={tr('from the seat belts')}>
      <QueryState query={occupancy}>
        {o && (
          <>
            {line && <p style={{ margin: '0 0 10px' }}>{line}</p>}
            <div className="grid cols-2">
              <div>
                <div className="sub-h">{tr('SHARE OF SNAPSHOTS WITH THE DRIVER BELTED')}</div>
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
                <div className="sub-h">{tr('FRONT PASSENGER BELTED, BY MONTH')}</div>
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
                            <div className="row"><span>{tr('Front passenger')}</span><span>{d.passengerPct ?? '—'}%</span></div>
                            <div className="row"><span>{tr('A rear seat')}</span><span>{d.rearPct ?? '—'}%</span></div>
                            <div className="row"><span>{tr('Snapshots')}</span><span>{d.belted}{d.few ? ` (${tr('few')})` : ''}</span></div>
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
            {seatList.length > 0 && (
              <div className="seat-map-wrap">
                <SeatMap list={seatList} />
                <dl className="kv">
                  {seatList.map((s) => (
                    <div key={s.id} style={{ display: 'contents' }}>
                      <dt>{s.label}</dt>
                      <dd>{s.id === 'driver' ? tr('the base') : `${s.pct ?? 0}%`} <span className="muted">({s.readings})</span></dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {sensors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="sub-h">{tr('SEAT SENSORS: READ OCCUPIED')}</div>
                <dl className="kv">
                  {sensors.map((s) => (
                    <div key={s.seat} style={{ display: 'contents' }}>
                      <dt>{s.label}</dt>
                      <dd>
                        {s.attention && <Badge kind="critical">{tr('check')}</Badge>} {s.pct === null ? '—' : `${s.pct}%`}{' '}
                        <span className="muted">({s.readings}{s.latest ? ` · ${tr('latest: {state}', { state: s.latest.toLowerCase() })}` : ''})</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
              {tr(OCCUPANCY_NOTE)}
              {seatList.length > 0 ? ` ${tr(SEATS_NOTE)}` : ''}
              {sensors.length > 0 ? ` ${tr(SENSORS_NOTE)}` : ''}
            </p>
          </>
        )}
      </QueryState>
    </Panel>
  )
}
