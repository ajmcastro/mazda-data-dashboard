import { useOverview, useSpan } from '../api/hooks'
import { daysInRange, editRange, fmtDate } from '../lib'
import { useDateRange } from '../range'

/** Period picker shown on the pages that describe a period. The range lives in the URL. */
export function DateRangeBar() {
  const { from, to, isFiltered, setRange, clear } = useDateRange()
  const span = useSpan().data
  const overview = useOverview().data

  const first = span?.first_day ?? undefined
  const last = span?.last_day ?? undefined
  const shownFrom = from ?? first
  const shownTo = to ?? last
  const days = shownFrom && shownTo ? daysInRange(shownFrom, shownTo) : undefined

  return (
    <div className="range-bar" role="group" aria-label="Period">
      <div className="range-inputs">
        <label>
          From
          <input
            type="date"
            value={from ?? ''}
            min={first}
            max={last}
            placeholder={first}
            onChange={(e) => setRange(editRange({ from, to }, 'from', e.target.value))}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to ?? ''}
            min={first}
            max={last}
            placeholder={last}
            onChange={(e) => setRange(editRange({ from, to }, 'to', e.target.value))}
          />
        </label>
        <button onClick={clear} disabled={!isFiltered}>
          All time
        </button>
      </div>
      <div className="range-summary mono">
        {shownFrom && shownTo ? (
          <>
            {fmtDate(shownFrom)} – {fmtDate(shownTo)}
            {days !== undefined && ` · ${days} day${days === 1 ? '' : 's'}`}
            {!isFiltered && ' · all time'}
          </>
        ) : (
          'no data yet'
        )}
      </div>
      {isFiltered && overview && !overview.has_data_in_range && (
        <div className="range-empty" role="status">
          No data in this period. The data covers {fmtDate(first)} – {fmtDate(last)}.{' '}
          <button onClick={clear}>Show all time</button>
        </div>
      )}
    </div>
  )
}
