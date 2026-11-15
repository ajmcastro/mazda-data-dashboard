import { t } from '../i18n'
import { Link, useSearchParams } from 'react-router-dom'
import { useDay } from '../api/hooks'
import { Badge, Panel, QueryState } from '../components/ui'
import { KIND_LABEL, dayShort, dayTitle, describe, isDay, placedAt, summary, when } from '../day'
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
            Everything the exports say about one day, in the car's own time{d ? ` (${d.time_zone})` : ''}. A drive and a fill-up are
            known only as “between two status reports”.
          </p>
        </div>
        {d && day && (
          <div className="controls">
            {d.previous ? (
              <Link className="preset day-step" to={href(d.previous)} aria-label={`Previous day with data, ${dayShort(d.previous)}`}>
                <span>← {dayShort(d.previous)}</span>
              </Link>
            ) : (
              <span className="preset day-step muted"><span>← none earlier</span></span>
            )}
            {d.next ? (
              <Link className="preset day-step" to={href(d.next)} aria-label={`Next day with data, ${dayShort(d.next)}`}>
                <span>{dayShort(d.next)} →</span>
              </Link>
            ) : (
              <span className="preset day-step muted"><span>none later →</span></span>
            )}
          </div>
        )}
      </div>
      <QueryState query={query}>
        {d && (
          <Panel>
            {!day ? (
              <div className="state">No data yet.</div>
            ) : d.entries.length === 0 ? (
              <div className="state">
                Nothing in the exports for this day.
                {d.previous && <> The day before with data is <Link to={href(d.previous)}>{dayShort(d.previous)}</Link>.</>}
                {d.next && <> The next is <Link to={href(d.next)}>{dayShort(d.next)}</Link>.</>}
              </div>
            ) : (
              <>
                <p style={{ margin: '0 0 12px' }}>{summary(d)}</p>
                <ol className="day-list">
                  {d.entries.map((e, i) => {
                    const line = describe(e)
                    return (
                      <li key={`${e.kind}-${e.at}-${e.code ?? e.ref ?? i}`} className={`day-entry kind-${e.kind}`}>
                        <span className="day-time mono" title={when(e, day)}>{placedAt(e, day)}</span>
                        <Badge kind={e.kind === 'alert' ? (e.severity ?? 'info') : 'dim'}>{KIND_LABEL[e.kind] ?? e.kind}</Badge>
                        <span className="day-what">
                          {line.to ? <Link to={to(line.to, line.params)}>{line.title}</Link> : line.title}
                          {(line.detail || when(e, day) !== placedAt(e, day)) && (
                            <span className="muted day-detail">
                              {[when(e, day) !== placedAt(e, day) ? when(e, day) : null, line.detail].filter(Boolean).join(' · ')}
                            </span>
                          )}
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
