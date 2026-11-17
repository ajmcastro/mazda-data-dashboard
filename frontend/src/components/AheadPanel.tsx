import { tr } from '../i18n'
import { useForecast, useMonthForecast, useTireForecast } from '../api/hooks'
import { aheadBasis, calendarEvents, icsFile, monthAhead, monthBasis, oilAhead, yearAhead } from '../forecast'
import { useCurrentModel } from '../model'
import { forecastLines } from '../tires'
import { Panel } from './ui'

/** Hand the reader a file made in the page: nothing is sent anywhere. */
function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Looking ahead (PLAN.md M52): the oil change and the year's distance at the recent pace, and a calendar file. */
export function AheadPanel() {
  const forecast = useForecast().data
  const tires = useTireForecast().data
  const month = useMonthForecast().data
  const { id, name } = useCurrentModel()
  if (!forecast?.has_data) return null
  const lines = [monthAhead(month), oilAhead(forecast), yearAhead(forecast), ...forecastLines(tires)].filter((l): l is string => !!l)
  const monthNote = monthBasis(month)
  if (lines.length === 0) return null
  const events = calendarEvents({ id, name }, forecast, tires)
  return (
    <Panel
      title={tr('Looking ahead')}
      hint={
        events.length > 0 ? (
          <button type="button" onClick={() => save(`${id}-forecast.ics`, icsFile(events, new Date()), 'text/calendar')}>
            {tr('Calendar file ({n})', { n: events.length })}
          </button>
        ) : (
          tr('at your recent pace')
        )
      }
    >
      {lines.map((line) => (
        <p key={line} style={{ margin: '0 0 8px' }}>{line}</p>
      ))}
      {monthNote && <p className="muted note">{monthNote}</p>}
      <p className="muted note">
        {aheadBasis(forecast)}
        {forecast.mileage_limit_km == null && (
          <> {tr('For a yearly limit (a lease or warranty year) add')} <span className="mono">mileage: {'{'}limit_km_per_year: 15000, start_date: 2026-03-03{'}'}</span> {tr('to')}{' '}
          <span className="mono">config/models/{id}/settings.yaml</span>.</>
        )}
      </p>
    </Panel>
  )
}
