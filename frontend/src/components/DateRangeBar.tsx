import { useOverview, useSpan } from '../api/hooks'
import {
  PRESETS,
  daysInRange,
  editRange,
  fmtDate,
  matchPreset,
  resolvePreset,
  type PresetId,
} from '../lib'
import { saveRangeChoice, useDateRange } from '../range'

/** Period picker shown on the pages that describe a period. The range lives in the URL. */
export function DateRangeBar() {
  const { from, to, isFiltered, setRange } = useDateRange()
  const span = useSpan().data
  const overview = useOverview().data

  const first = span?.first_day ?? undefined
  const last = span?.last_day ?? undefined
  const shownFrom = from ?? first
  const shownTo = to ?? last
  const days = shownFrom && shownTo ? daysInRange(shownFrom, shownTo) : undefined
  const active = matchPreset({ from, to }, first, last)
  const activeLabel = PRESETS.find((p) => p.id === active)?.label

  const choose = (id: PresetId) => {
    saveRangeChoice(id)
    setRange(first && last ? resolvePreset(id, first, last) : {})
  }
  const edit = (which: 'from' | 'to', value: string) => {
    saveRangeChoice('custom')
    setRange(editRange({ from, to }, which, value))
  }

  return (
    <div className="range-bar" role="group" aria-label="Period">
      <fieldset className="presets" disabled={!span}>
        <legend className="sr-only">Quick ranges, counted back from the newest data</legend>
        {PRESETS.map((p) => (
          <label key={p.id} className="preset">
            <input
              type="radio"
              name="preset"
              checked={active === p.id}
              onChange={() => choose(p.id)}
            />
            <span>{p.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="range-inputs">
        <label>
          From
          <input
            type="date"
            value={from ?? ''}
            min={first}
            max={last}
            onChange={(e) => edit('from', e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to ?? ''}
            min={first}
            max={last}
            onChange={(e) => edit('to', e.target.value)}
          />
        </label>
      </div>

      <div className="range-summary mono" aria-live="polite">
        {shownFrom && shownTo ? (
          <>
            <b>{activeLabel ?? 'Custom range'}</b> · {fmtDate(shownFrom)} – {fmtDate(shownTo)}
            {days !== undefined && ` · ${days} day${days === 1 ? '' : 's'}`}
          </>
        ) : (
          'no data yet'
        )}
      </div>

      {isFiltered && overview && !overview.has_data_in_range && (
        <div className="range-empty" role="status">
          No data in this period. The data covers {fmtDate(first)} – {fmtDate(last)}.{' '}
          <button onClick={() => choose('all')}>Show all time</button>
        </div>
      )}
    </div>
  )
}
