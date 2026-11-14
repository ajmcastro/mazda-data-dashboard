import { useDrivingPattern } from '../api/hooks'
import type { DrivingBandTotal } from '../api/types'
import { bandLabel, describeMix, drivingNotes, headline, mixChanges, pct, share, shortShare, unclassifiedNote } from '../driving'
import { fmtNum } from '../lib'
import { monthLabel } from '../trends'
import { consumptionLabel, fmtConsumption, fmtDistance, fmtSpeed } from '../units'
import { Panel, QueryState } from './ui'

/** How the car is driven (PLAN.md M48): the stretches of driving by length, in total and by month. */
export function DrivingPanel() {
  const query = useDrivingPattern()
  const d = query.data
  const changes = d ? mixChanges(d.months) : []
  const note = unclassifiedNote(d)
  return (
    <Panel title="How the car is driven" hint="stretches of driving between two status reports, by length">
      <QueryState query={query}>
        {d && (
          <>
            <p style={{ margin: '0 0 10px' }}>{headline(d)}</p>
            {d.stretches > 0 && (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Length</th>
                        <th className="num">Stretches</th>
                        <th className="num">Distance</th>
                        <th>Share of the distance</th>
                        <th className="num">Fuel</th>
                        <th className="num">{consumptionLabel()}</th>
                        <th className="num">Average speed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.bands.map((b: DrivingBandTotal) => {
                        const of = share(b.km, d.km)
                        return (
                          <tr key={b.band}>
                            <td>{bandLabel(b)}</td>
                            <td className="num">
                              {fmtNum(b.stretches)} <span className="muted">({pct(share(b.stretches, d.stretches))})</span>
                            </td>
                            <td className="num">{fmtDistance(b.km)}</td>
                            <td>
                              <span className="bar" style={{ display: 'inline-block', width: 120, verticalAlign: 'middle' }}>
                                <i style={{ width: `${of ?? 0}%` }} />
                              </span>{' '}
                              <span className="mono">{pct(of)}</span>
                            </td>
                            <td className="num">{fmtNum(b.fuel_l, 1)} l</td>
                            <td className="num">{fmtConsumption(b.l_per_100km, 1)}</td>
                            <td className="num">{fmtSpeed(b.avg_speed_kmh)}</td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td><b>All in a band</b></td>
                        <td className="num">{fmtNum(d.stretches)}</td>
                        <td className="num">{fmtDistance(d.km)}</td>
                        <td />
                        <td className="num">{fmtNum(d.fuel_l, 1)} l</td>
                        <td className="num">{fmtConsumption(d.l_per_100km, 1)}</td>
                        <td className="num">{fmtSpeed(d.avg_speed_kmh)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {note && <p className="muted note">{note}</p>}

                {d.months.length > 1 && (
                  <>
                    <h3 className="sub-head" style={{ margin: '18px 0 8px' }}>By month</h3>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th className="num">Stretches</th>
                            <th className="num">Distance</th>
                            <th className="num">{consumptionLabel()}</th>
                            {d.bands.map((b) => (
                              <th key={b.band} className="num">{bandLabel(b)}</th>
                            ))}
                            <th className="num">Short, of the distance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.months.map((m) => {
                            const km = m.bands.reduce((s, b) => s + b.km, 0)
                            return (
                              <tr key={m.month}>
                                <td>{monthLabel(m.month)}</td>
                                <td className="num">{fmtNum(m.stretches)}</td>
                                <td className="num">{fmtDistance(m.km)}</td>
                                <td className="num">{fmtConsumption(m.l_per_100km, 1)}</td>
                                {m.bands.map((b) => (
                                  <td key={b.band} className="num">{pct(share(b.km, km))}</td>
                                ))}
                                <td className="num">{pct(shortShare(m.bands))}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted note">
                      The columns by length are each month's share of the distance; “short” adds the first two.
                    </p>
                    {changes.map((c) => (
                      <p key={c.month} style={{ margin: '10px 0 0' }}>{describeMix(c)}</p>
                    ))}
                  </>
                )}
                <ul className="car-notes muted">
                  {drivingNotes(d.min_km).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </QueryState>
    </Panel>
  )
}
