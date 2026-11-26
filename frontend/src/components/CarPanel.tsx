import { msg, tr, trn } from '../i18n'
import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAlerts, useCarWarnings, useDoors, useOilService, useOverview, useSignalValues, useStatusTimeline, useTireForecast, useTires, useUnusualReports, useFrameVoltage } from '../api/hooks'
import { meanings } from '../signals'
import { engineNote } from '../voltage'
import { MOMENT_MINUTES, momentOf, moments, reasonText } from '../unusual'
import { PartAlerts } from './PartAlerts'
import { notesByPart } from '../tires'
import {
  carNotes, CAR_VIEW_KEY, carHeadline, carState, carView, listedParts, parseCarView, stateBadge, type CarState, type CarView, type PartGroup, alertCounts, SCRUB_NOTE, carStateAt, reportText,
} from '../car'
import { bodyOfModel } from '../car3d/shapes/common' // not geometry.ts: the outlines belong in the 3D chunk
import { ANIMATE, fmtDateTime } from '../lib'
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
    this.props.onError(tr('The 3D view could not be loaded.'))
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

const GROUPS: { group: PartGroup; title: string }[] = [
  { group: 'wheels', title: msg('WHEELS') },
  { group: 'doors', title: msg('DOORS, TRUNK AND HOOD') },
  { group: 'other', title: msg('FUEL, ENGINE AND DASHBOARD') },
]

/** The parts as a list: the panel of M38, and the fallback and text equivalent of the 3D view (PLAN.md M39). */
export function CarList({ car }: { car: CarState }) {
  const groups = GROUPS.map((g) => ({ ...g, parts: listedParts(car, g.group) })).filter((g) => g.parts.length > 0)
  return (
    <div className="car-groups">
      {groups.map((g) => (
        <div key={g.group}>
          <div className="sub-h">{tr(g.title)}</div>
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
                  <PartAlerts part={p} />
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
  const forecast = useTireForecast()
  const openAlerts = useAlerts('new') // acknowledging one reads them again, and its marker goes
  // the overview and the doors carry the figures; the oil countdown and the flags are extras a car may lack,
  // so the panel does not wait for them and a failure of theirs does not hide the rest
  const query = overview.isError || !doors.isError ? overview : doors
  const pending = overview.isPending || doors.isPending
  // a battery trend of the freeze frames (M68) is a note on the engine, never a state
  const battery = engineNote(useFrameVoltage().data)
  const notes = { ...notesByPart(forecast.data), ...(battery ? { engine: battery } : {}) }
  // what the platform documents the values to mean (M72): the words for the locks, the flags and the engine
  const documented = meanings(useSignalValues().data)
  const newest = carState(overview.data, doors.data?.[0], oil.data, carWarnings.data, notes, alertCounts(openAlerts.data), documented)
  // the time scrubber (M56): the reports of the period, one step each; null = the newest, as the panel always showed
  const reports = useStatusTimeline().data
  const total = reports?.length ?? 0
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const looking = step !== null && step < total - 1
  const doorHistory = useDoors(5000, looking || playing)
  const tireHistory = useTires()
  const back = looking ? carStateAt(step, reports, doorHistory.data, tireHistory.data, documented) : null
  // the reports unlike the car's others (M64), as ticks on the slider and a line under it
  const unusual = moments(useUnusualReports().data?.reports)
  const marked = (reports ?? []).flatMap((r, i) => (momentOf(r.created_at, unusual, MOMENT_MINUTES) ? [i] : []))
  const markedMoments = new Set((reports ?? []).map((r) => momentOf(r.created_at, unusual, MOMENT_MINUTES)?.at).filter(Boolean)).size
  const standsOut = back ? momentOf(back.at, unusual, MOMENT_MINUTES) : undefined
  const car = back ? back.car : newest
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setStep((now) => {
        const next = (now ?? 0) + 1
        if (next >= total - 1) {
          setPlaying(false)
          return null // back at the newest report
        }
        return next
      })
    }, 450)
    return () => clearInterval(timer)
  }, [playing, total])
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
    <Panel title={tr('The car')} hint={back ? `${reportText(back)} · ${fmtDateTime(back.at)}` : car.asOf ? tr('as of {at}', { at: fmtDateTime(car.asOf) }) : tr('part by part')}>
      <QueryState query={{ isPending: pending, isError: query.isError, error: query.error }}>
        <div className="car-top">
          <p>{carHeadline(car)}</p>
          {car.hasData && (
            <div className="theme-toggle" role="group" aria-label={tr('How the car is shown')}>
              <button type="button" aria-pressed={view === '3d'} onClick={() => choose('3d')}>3D</button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => choose('list')}>{tr('List')}</button>
            </div>
          )}
        </div>
        {car.hasData && (
          <>
            {failed && choice === '3d' && <p className="muted car-failed">{failed} {tr('Showing the list instead.')}</p>}
            {view === '3d' ? (
              <Guard key={attempt} onError={setFailed}>
                <Suspense fallback={list}>
                  <Car3D car={car} body={body} onFail={setFailed} />
                </Suspense>
              </Guard>
            ) : (
              list
            )}
            {total > 1 && (
              <div className="car-scrub">
                {ANIMATE && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!playing && !looking) setStep(0) // from the newest: start at the first report
                      setPlaying(!playing)
                    }}
                    aria-label={playing ? tr('Pause') : tr('Play through the reports of the period')}
                  >
                    {playing ? tr('Pause') : tr('Play')}
                  </button>
                )}
                <input
                  type="range"
                  min={0}
                  max={total - 1}
                  step={1}
                  value={step ?? total - 1}
                  list={marked.length ? 'car-scrub-unusual' : undefined}
                  onChange={(e) => {
                    setPlaying(false)
                    const next = Number(e.target.value)
                    setStep(next >= total - 1 ? null : next)
                  }}
                  aria-label={tr('Status report shown, from the first of the period to the newest')}
                  aria-valuetext={back ? `${reportText(back)}, ${fmtDateTime(back.at)}` : tr('the newest report')}
                />
                {marked.length > 0 && (
                  <datalist id="car-scrub-unusual">
                    {marked.map((i) => <option key={i} value={i} />)}
                  </datalist>
                )}
                <span className="mono muted car-scrub-at">{back ? `${reportText(back)} · ${fmtDateTime(back.at)}` : tr('newest')}</span>
                {looking && <button type="button" onClick={() => { setPlaying(false); setStep(null) }}>{tr('Newest')}</button>}
              </div>
            )}
            {looking && <p className="muted note">{tr(SCRUB_NOTE)}</p>}
            {standsOut && (
              <p className="note">
                {tr('This report stands out from the car’s others: {reasons}.', { reasons: standsOut.reasons.map(reasonText).join('; ') })}
              </p>
            )}
            {marked.length > 0 && !looking && (
              <p className="muted note">{trn('The ticks on the slider mark the reports of a moment that stands out from the car’s others.', 'The ticks on the slider mark the reports of {n} moments that stand out from the car’s others.', markedMoments)}</p>
            )}
            <ul className="car-notes muted">
              {carNotes(documented).map((n) => (
                <li key={n}>{tr(n)}</li>
              ))}
            </ul>
          </>
        )}
      </QueryState>
    </Panel>
  )
}
