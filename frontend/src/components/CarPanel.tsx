import { useCarWarnings, useDoors, useOilService, useOverview } from '../api/hooks'
import { CAR_NOTES, carHeadline, carState, listedParts, stateBadge, type CarState, type PartGroup } from '../car'
import { fmtDateTime } from '../lib'
import { Badge, Panel, QueryState } from './ui'

const GROUPS: { group: PartGroup; title: string }[] = [
  { group: 'wheels', title: 'WHEELS' },
  { group: 'doors', title: 'DOORS, TRUNK AND HOOD' },
  { group: 'other', title: 'FUEL, ENGINE AND DASHBOARD' },
]

/** The parts as a list: the panel of M38, and the fallback and text equivalent of the 3D view (PLAN.md M39). */
export function CarList({ car }: { car: CarState }) {
  const groups = GROUPS.map((g) => ({ ...g, parts: listedParts(car, g.group) })).filter((g) => g.parts.length > 0)
  return (
    <div className="car-groups">
      {groups.map((g) => (
        <div key={g.group}>
          <div className="sub-h">{g.title}</div>
          <ul className="car-list">
            {g.parts.map((p) => {
              const badge = stateBadge(p)
              return (
                <li key={p.id} className={`car-part ${p.state}`}>
                  <div className="car-part-head">
                    <span className="car-part-name">{p.name}</span>
                    <span className="car-part-value">
                      {badge && <Badge kind={badge.kind}>{badge.text}</Badge>} {p.value}
                    </span>
                  </div>
                  {p.notes.map((n) => (
                    <div key={n} className="car-part-note">{n}</div>
                  ))}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** What the car's latest status reports say, part by part (PLAN.md M38). */
export function CarPanel() {
  const overview = useOverview()
  const doors = useDoors(1)
  const oil = useOilService()
  const carWarnings = useCarWarnings()
  // the overview and the doors carry the figures; the oil countdown and the flags are extras a car may lack,
  // so the panel does not wait for them and a failure of theirs does not hide the rest
  const query = overview.isError || !doors.isError ? overview : doors
  const pending = overview.isPending || doors.isPending
  const car = carState(overview.data, doors.data?.[0], oil.data, carWarnings.data)
  return (
    <Panel title="The car" hint={car.asOf ? `as of ${fmtDateTime(car.asOf)}` : 'part by part'}>
      <QueryState query={{ isPending: pending, isError: query.isError, error: query.error }}>
        <p style={{ margin: '0 0 12px' }}>{carHeadline(car)}</p>
        {car.hasData && (
          <>
            <CarList car={car} />
            <ul className="car-notes muted">
              {CAR_NOTES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
      </QueryState>
    </Panel>
  )
}
