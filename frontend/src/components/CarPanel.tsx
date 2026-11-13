import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { useCarWarnings, useDoors, useOilService, useOverview } from '../api/hooks'
import {
  CAR_NOTES, CAR_VIEW_KEY, carHeadline, carState, carView, listedParts, parseCarView, stateBadge,
  type CarState, type CarView, type PartGroup,
} from '../car'
import { bodyOfModel } from '../car3d/shapes/common' // not geometry.ts: the outlines belong in the 3D chunk
import { fmtDateTime } from '../lib'
import { useCurrentModel } from '../model'
import { Badge, Panel, QueryState } from './ui'

// three.js is only fetched when the 3D view is shown (PLAN.md M39): keep this the only import of it
const Car3D = lazy(() => import('../car3d/Car3D'))

function savedView(): CarView {
  try {
    return parseCarView(localStorage.getItem(CAR_VIEW_KEY))
  } catch {
    return '3d'
  }
}

/** Catches a 3D view that could not be loaded or crashed, so the list is shown instead of a broken page. */
class Guard extends Component<{ onError: (why: string) => void; children: ReactNode }, { broken: boolean }> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch() {
    this.props.onError('The 3D view could not be loaded.')
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

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
  // the model's own dimensions and steering side (model.yaml `body:`); none = the generic car
  const modelBody = useCurrentModel().model?.body
  const body = useMemo(() => bodyOfModel(modelBody), [modelBody])
  const [choice, setChoice] = useState(savedView)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const view = carView(choice, failed)
  const choose = (next: CarView) => {
    setChoice(next)
    if (next === '3d') {
      setFailed(null) // asking again is a retry
      setAttempt((n) => n + 1)
    }
    try {
      localStorage.setItem(CAR_VIEW_KEY, next)
    } catch {
      /* not remembered */
    }
  }
  const list = <CarList car={car} />
  return (
    <Panel title="The car" hint={car.asOf ? `as of ${fmtDateTime(car.asOf)}` : 'part by part'}>
      <QueryState query={{ isPending: pending, isError: query.isError, error: query.error }}>
        <div className="car-top">
          <p>{carHeadline(car)}</p>
          {car.hasData && (
            <div className="theme-toggle" role="group" aria-label="How the car is shown">
              <button type="button" aria-pressed={view === '3d'} onClick={() => choose('3d')}>3D</button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => choose('list')}>List</button>
            </div>
          )}
        </div>
        {car.hasData && (
          <>
            {failed && choice === '3d' && <p className="muted car-failed">{failed} Showing the list instead.</p>}
            {view === '3d' ? (
              <Guard key={attempt} onError={setFailed}>
                <Suspense fallback={list}>
                  <Car3D car={car} body={body} onFail={setFailed} />
                </Suspense>
              </Guard>
            ) : (
              list
            )}
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
