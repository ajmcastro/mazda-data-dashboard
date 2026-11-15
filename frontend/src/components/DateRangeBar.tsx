import { t, tr, trn } from '../i18n'
import { useState } from 'react'
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
  // on a narrow screen the controls fold away behind the summary line (CSS only shows the toggle there)
  const [open, setOpen] = useState(false)
  const span = useSpan().data
  const overview = useOverview().data

  const first = span?.first_day ?? undefined
  const last = span?.last_day ?? undefined
  const shownFrom = from ?? first
  const shownTo = to ?? last
  const days = shownFrom && shownTo ? daysInRange(shownFrom, shownTo) : undefined
  const active = matchPreset({ from, to }, first, last)
  const activePreset = PRESETS.find((p) => p.id === active)
  const activeLabel = activePreset ? t(`range.${activePreset.id}`) : undefined

  const choose = (id: PresetId) => {
    saveRangeChoice(id)
    setRange(first && last ? resolvePreset(id, first, last) : {})
  }
  const edit = (which: 'from' | 'to', value: string) => {
    saveRangeChoice('custom')
    setRange(editRange({ from, to }, which, value))
  }

  return (
    <div className={`range-bar${open ? ' open' : ''}`} role="group" aria-label={tr('Period')}>
      <div className="range-controls" id="range-controls">
      <fieldset className="presets" disabled={!span}>
        <legend className="sr-only">{tr('Quick ranges, counted back from the newest data')}</legend>
        {PRESETS.map((p) => (
          <label key={p.id} className="preset">
            <input
              type="radio"
              name="preset"
              checked={active === p.id}
              onChange={() => choose(p.id)}
            />
            <span>{t(`range.${p.id}`)}</span>
          </label>
        ))}
      </fieldset>

      <div className="range-inputs">
        <label>
          {tr('From')}
          <input
            type="date"
            value={from ?? ''}
            min={first}
            max={last}
            onChange={(e) => edit('from', e.target.value)}
          />
        </label>
        <label>
          {tr('To')}
          <input
            type="date"
            value={to ?? ''}
            min={first}
            max={last}
            onChange={(e) => edit('to', e.target.value)}
          />
        </label>
      </div>
      </div>

      <div className="range-summary mono" aria-live="polite">
        <span className="range-text">
          {shownFrom && shownTo ? (
            <>
              <b>{activeLabel ?? tr('Custom range')}</b> · {fmtDate(shownFrom)} – {fmtDate(shownTo)}
              {days !== undefined && ` · ${trn('{n} day', '{n} days', days)}`}
            </>
          ) : (
            tr('no data yet')
          )}
        </span>
        <button
          type="button"
          className="range-toggle"
          aria-expanded={open}
          aria-controls="range-controls"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? tr('Done') : tr('Change')}
        </button>
      </div>

      {isFiltered && overview && !overview.has_data_in_range && (
        <div className="range-empty" role="status">
          {tr('No data in this period. The data covers {from} – {to}.', { from: fmtDate(first), to: fmtDate(last) })}{' '}
          <button onClick={() => choose('all')}>{tr('Show all time')}</button>
        </div>
      )}
    </div>
  )
}
