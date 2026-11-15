import { t } from '../i18n'
import { useRef, useState } from 'react'
import { useImportFile, useImports, useWritable } from '../api/hooks'
import type { ImportSummary } from '../api/types'
import { RangeLink } from '../components/RangeLink'
import { Panel, QueryState } from '../components/ui'
import { IMPORT_NOTES, changeLines, filesLine, looksImportable } from '../imports'
import { fmtDateTime } from '../lib'
import { useCurrentModel } from '../model'

type Result = { name: string; summary?: ImportSummary; error?: string }

function Summary({ s }: { s: ImportSummary }) {
  const lines = changeLines(s)
  return (
    <div className="import-result">
      <b>{s.source}</b> <span className="muted">{fmtDateTime(s.imported_at)}</span>
      <div>{filesLine(s)}</div>
      {lines.map((line) => (
        <div key={line} className="muted">{line}</div>
      ))}
    </div>
  )
}

/** Import Mazda's download from the dashboard (PLAN.md M53). The Mac only: the phone gets packs. */
export default function ImportPage() {
  const writable = useWritable()
  const { id, name, model } = useCurrentModel()
  const hasData = model?.has_data !== false
  const past = useImports(hasData)
  const send = useImportFile()
  const input = useRef<HTMLInputElement>(null)
  const [results, setResults] = useState<Result[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  async function take(files: FileList | File[]) {
    const list = [...files]
    const done: Result[] = []
    for (const file of list) {
      if (!looksImportable(file.name)) {
        done.push({ name: file.name, error: "This is not one of Mazda's export files (the zip, the CSV files or the diagnostic report)." })
        continue
      }
      setBusy(file.name)
      try {
        done.push({ name: file.name, summary: await send.mutateAsync(file) })
      } catch (e) {
        done.push({ name: file.name, error: e instanceof Error ? e.message : 'The import failed.' })
      }
      setResults([...done])
    }
    setResults([...done])
    setBusy(null)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('page.import')}</h1>
          <p>Add a new download from Mazda to {name} without a terminal.</p>
        </div>
      </div>
      {!writable ? (
        <Panel>
          <div className="state">
            This server is read-only (the demo, or <span className="mono">MAZDA_READONLY</span> is set), so nothing can be imported here. Put the files in{' '}
            <span className="mono">data/{id}/</span> and run <span className="mono">make ingest</span>.
          </div>
        </Panel>
      ) : (
        <Panel title={`Files for ${name}`} hint={`stored in data/${id}/`}>
          <div
            className={`drop-zone${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              if (!busy) void take(e.dataTransfer.files)
            }}
          >
            <p>{busy ? `Loading ${busy} …` : 'Drop the zip from Mazda here, or its export files.'}</p>
            <button type="button" disabled={busy !== null} onClick={() => input.current?.click()}>Choose files</button>
            <input
              ref={input}
              type="file"
              multiple
              accept=".zip,.csv,.txt"
              hidden
              onChange={(e) => {
                if (e.target.files) void take(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
          {results.map((r, i) => (
            <div key={`${r.name}-${i}`} className={`alert-row ${r.error ? 'bad' : 'ok'}`} style={{ marginTop: 10, display: 'block' }}>
              {r.summary ? <Summary s={r.summary} /> : <><b>{r.name}</b> <span>{r.error}</span></>}
            </div>
          ))}
          {results.some((r) => r.summary) && (
            <p className="note">
              See it on the <RangeLink to="/">Overview</RangeLink> and the <RangeLink to="/alerts">Alerts</RangeLink>. The period at the top of a page may still end at the old newest day.
            </p>
          )}
          <ul className="car-notes muted">
            {IMPORT_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>If these files are for another car, pick that car's model in the menu first: the files go to the model on screen.</li>
          </ul>
        </Panel>
      )}
      {hasData && <div style={{ marginTop: 14 }}>
        <Panel title="Earlier imports" hint="made from this page">
          <QueryState query={past}>
            {past.data && past.data.length === 0 && <p className="muted" style={{ margin: 0 }}>None yet. Loads made with <span className="mono">make ingest</span> are not listed here.</p>}
            {past.data?.map((s) => (
              <div key={s.imported_at + s.source} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <Summary s={s} />
              </div>
            ))}
          </QueryState>
        </Panel>
      </div>}
    </>
  )
}
