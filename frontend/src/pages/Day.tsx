import { t, tr } from '../i18n'
import { Link, useSearchParams } from 'react-router-dom'
import { useDay, useRoutines, useSignalValues, useUnusualReports } from '../api/hooks'
import { meanings } from '../signals'
import { Badge, Panel, QueryState } from '../components/ui'
import { KIND_LABEL, addDays, dayShort, dayTitle, describe, isDay, placedAt, summary, when } from '../day'
import { standsOut } from '../unusual'
import { routineOf } from '../routines'
import { useDayHref, useRangeSearch } from '../range'

/** One day at a glance (PLAN.md M49): everything the exports say about one day, in the car's local time. */
export default function DayPage() {
  const [params] = useSearchParams()
  const asked = params.get('day')
  const query = useDay(isDay(asked) ? asked : undefined)
  const href = useDayHref()
  const search = useRangeSearch()
  const d = query.data
  const day = d?.date ?? null
  // the reports of this day that stand out (M64): the UTC days around the car's local day, whatever the period
  const unusual = useUnusualReports(day ? { from: addDays(day, -1), to: addDays(day, 1) } : undefined)
  const routines = useRoutines() // a drive's routine (M66), matched by the time its stretch ended
  const documented = meanings(useSignalValues().data) // the engine state and the alarm in words (M72)
  const to = (path: string, extra?: Record<string, string>) => {
    const p = new URLSearchParams(search)
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v)
    const s = p.toString()
    return { pathname: path, search: s ? `?${s}` : '' }
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{day ? dayTitle(day) : t('page.day')}</h1>
          <p>
            {tr("Everything the exports say about one day, in the car's own time{zone}. A drive and a fill-up are known only as “between two status reports”.", { zone: d ? ` (${d.time_zone})` : '' })}
          </p>
        </div>
        {d && day && (
          <div className="controls">
            {d.previous ? (
              <Link className="preset day-step" to={href(d.previous)} aria-label={tr('Previous day with data, {day}', { day: dayShort(d.previous) })}>
                <span>← {dayShort(d.previous)}</span>
              </Link>
            ) : (
              <span className="preset day-step muted"><span>{tr('← none earlier')}</span></span>
            )}
            {d.next ? (
              <Link className="preset day-step" to={href(d.next)} aria-label={tr('Next day with data, {day}', { day: dayShort(d.next) })}>
                <span>{dayShort(d.next)} →</span>
              </Link>
            ) : (
              <span className="preset day-step muted"><span>{tr('none later →')}</span></span>
            )}
          </div>
        )}
      </div>
      <QueryState query={query}>
        {d && (
          <Panel>
            {!day ? (
              <div className="state">{tr('No data yet.')}</div>
            ) : d.entries.length === 0 ? (
              <div className="state">
                {tr('Nothing in the exports for this day.')}
                {d.previous && <> {tr('The day before with data is')} <Link to={href(d.previous)}>{dayShort(d.previous)}</Link>.</>}
                {d.next && <> {tr('The next is')} <Link to={href(d.next)}>{dayShort(d.next)}</Link>.</>}
              </div>
            ) : (
              <>
                <p style={{ margin: '0 0 12px' }}>{summary(d)}</p>
                <ol className="day-list">
                  {d.entries.map((e, i) => {
                    const line = describe(e, documented)
                    const odd = standsOut(e.kind, e.at, unusual.data?.reports)
                    // a drive's `at` is the report before the stretch, `until` the one at its end: routines are by the end
                    const routine = e.kind === 'drive' ? routineOf(e.until, routines.data) : null
                    return (
                      <li key={`${e.kind}-${e.at}-${e.code ?? e.ref ?? i}`} className={`day-entry kind-${e.kind}`}>
                        <span className="day-time mono" title={when(e, day)}>{placedAt(e, day)}</span>
                        <Badge kind={e.kind === 'alert' ? (e.severity ?? 'info') : 'dim'}>{tr(KIND_LABEL[e.kind] ?? e.kind)}</Badge>
                        <span className="day-what">
                          {line.to ? <Link to={to(line.to, line.params)}>{line.title}</Link> : line.title}
                          {(line.detail || when(e, day) !== placedAt(e, day)) && (
                            <span className="muted day-detail">
                              {[when(e, day) !== placedAt(e, day) ? when(e, day) : null, line.detail].filter(Boolean).join(' · ')}
                            </span>
                          )}
                          {odd && <span className="day-detail day-unusual">{odd}</span>}
                          {routine && <span className="muted day-detail">{routine}</span>}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
          </Panel>
        )}
      </QueryState>
    </>
  )
}
