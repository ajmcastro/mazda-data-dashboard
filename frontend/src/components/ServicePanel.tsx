import { tr } from '../i18n'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAddServiceEntry, useServiceLog, useWritable } from '../api/hooks'
import type { ServiceEntry } from '../api/types'
import { fmtDate } from '../lib'
import { useCurrentModel } from '../model'
import { useDayHref } from '../range'
import { EMPTY_DRAFT, draftFrom, kindLabel, problems, suggestionText, toEntry, yamlLine, type Draft } from '../service'
import { fmtDistance } from '../units'
import { Badge, DataTable, Panel, QueryState, type Column } from './ui'

/** The service log (PLAN.md M50): what the owner noted, what the data hints at, and (on the Mac) a form. */
export function ServicePanel() {
  const query = useServiceLog()
  const writable = useWritable()
  const add = useAddServiceEntry()
  const { id } = useCurrentModel()
  const dayHref = useDayHref()
  const [draft, setDraft] = useState<Draft | null>(null)
  const d = query.data
  const kinds = d?.kinds ?? []
  const wrong = draft ? problems(draft, kinds) : []
  const file = `config/models/${id}/service_log.yaml`
  const columns: Column<ServiceEntry>[] = [
    { key: 'date', header: tr('Day'), sort: (e) => e.date, render: (e) => <Link to={dayHref(e.date)}>{fmtDate(e.date)}</Link> },
    { key: 'kind', header: tr('Kind'), sort: (e) => e.kind, render: (e) => <Badge kind="dim">{kindLabel(e.kind)}</Badge> },
    { key: 'note', header: tr('Note'), render: (e) => <span style={{ whiteSpace: 'normal' }}>{e.note}</span> },
    { key: 'odo', header: tr('Odometer'), num: true, sort: (e) => e.odometer_km ?? -1, render: (e) => fmtDistance(e.odometer_km) },
  ]
  const set = (patch: Partial<Draft>) => setDraft((now) => ({ ...(now ?? EMPTY_DRAFT), ...patch }))
  return (
    <Panel
      title={tr('Service log')}
      hint={
        writable ? (
          <button type="button" onClick={() => setDraft(draft ? null : EMPTY_DRAFT)}>{draft ? tr('Cancel') : tr('Add an entry')}</button>
        ) : (
          tr('what you noted was done to the car')
        )
      }
    >
      <QueryState query={query}>
        {d && (
          <>
            {draft && writable && (
              <form
                className="service-form"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  if (wrong.length === 0) add.mutate(toEntry(draft), { onSuccess: () => setDraft(null) })
                }}
              >
                <label>{tr('Day')} <input type="date" value={draft.date} onChange={(ev) => set({ date: ev.target.value })} required /></label>
                <label>
                  {tr('Kind')}{' '}
                  <select value={draft.kind} onChange={(ev) => set({ kind: ev.target.value })}>
                    {kinds.map((k) => (
                      <option key={k} value={k}>{kindLabel(k)}</option>
                    ))}
                  </select>
                </label>
                <label className="grow">{tr('Note')} <input type="text" value={draft.note} maxLength={200} onChange={(ev) => set({ note: ev.target.value })} placeholder={tr('what was done')} /></label>
                <label>{tr('Odometer (kilometres, optional)')} <input type="number" min={0} value={draft.odometer} onChange={(ev) => set({ odometer: ev.target.value })} /></label>
                <button type="submit" disabled={wrong.length > 0 || add.isPending}>{tr('Save to the log')}</button>
                {(draft.note !== '' || draft.date !== '') && wrong.map((w) => <p key={w} className="muted note">{w}</p>)}
                {add.isError && <p className="note" style={{ color: 'var(--accent)' }}>{add.error.message}</p>}
                <p className="muted note">{tr('Saved as one line at the end of')} <span className="mono">{file}</span>; {tr('nothing else in the file changes.')}</p>
              </form>
            )}
            {d.entries.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {tr('Nothing noted yet.')} {writable ? tr('Use “Add an entry”, or keep a list in') : tr('Keep a list in')} <span className="mono">{file}</span> {tr('and run')}{' '}
                <span className="mono">make model</span>.
              </p>
            ) : (
              <DataTable rows={d.entries} columns={columns} rowKey={(e) => `${e.date}|${e.kind}|${e.note}`} />
            )}
            {d.suggestions.length > 0 && (
              <>
                <h3 className="sub-head" style={{ margin: '16px 0 6px' }}>{tr('Not in the log')}</h3>
                <ul className="service-suggestions">
                  {d.suggestions.map((s) => (
                    <li key={`${s.reason}|${s.date}`}>
                      {suggestionText(s)}{' '}
                      {writable ? (
                        <button type="button" onClick={() => setDraft(draftFrom(s))}>{tr('Add it')}</button>
                      ) : (
                        <span className="mono muted">{yamlLine({ ...s, note: '' })}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="muted note">
                  {tr('These are hints from the data, never entries: nothing is added unless you add it')}
                  {writable ? '.' : <> {tr('(paste the line into')} <span className="mono">{file}</span>{tr(', write the note, run')} <span className="mono">make model</span> {tr('and make a new pack).')}</>}
                </p>
              </>
            )}
          </>
        )}
      </QueryState>
    </Panel>
  )
}
