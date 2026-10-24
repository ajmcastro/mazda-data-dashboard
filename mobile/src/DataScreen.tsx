import { useRef, useState } from 'react'
import { useController, useData } from './data'

const fmtBytes = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function DataScreen() {
  const controller = useController()
  const { status, message, info, error } = useData()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const working = busy || status === 'starting' || status === 'loading'

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      await controller.importPack(new Uint8Array(await file.arrayBuffer()), file.name)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = '' // choosing the same file again must fire a change
    }
  }

  async function demo() {
    setBusy(true)
    try {
      await controller.loadDemo()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Delete all data from this device? You can import the data pack again at any time.')) return
    setBusy(true)
    try {
      await controller.deleteData()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data on this phone</h1>
          <p>Everything stays on this device: the app never sends your data anywhere.</p>
        </div>
      </div>

      {working && (
        <div className="state" role="status">
          {message || 'Working…'}
        </div>
      )}

      {error && (
        <div className="state error" role="alert">
          {error}
          <button type="button" className="linklike" onClick={() => controller.clearError()}>Dismiss</button>
        </div>
      )}

      {info && (
        <section className="panel data-info" aria-label="Data pack">
          <h2>{info.name === 'demo' ? 'Demo data (synthetic)' : info.name}</h2>
          <dl>
            <dt>Data from</dt>
            <dd>{fmtDay(info.manifest.first_data_day)} to {fmtDay(info.manifest.last_data_day)}</dd>
            <dt>Pack created</dt>
            <dd>{fmtWhen(info.manifest.created_at)}</dd>
            <dt>Imported</dt>
            <dd>{fmtWhen(info.savedAt)}</dd>
            <dt>Size</dt>
            <dd>{fmtBytes(info.bytes)}</dd>
          </dl>
        </section>
      )}

      {status !== 'starting' && (
        <div className="data-actions">
          <label className={`button primary${working ? ' disabled' : ''}`}>
            {info ? 'Replace with another pack' : 'Import data pack'}
            {/* no `accept`: iOS greys out files with an extension it does not know (.cx5pack) */}
            <input
              ref={input}
              type="file"
              disabled={working}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          {!info && (
            <button type="button" className="button" disabled={working} onClick={() => void demo()}>
              Load demo data
            </button>
          )}
          {info && (
            <button type="button" className="button danger" disabled={working} onClick={() => void remove()}>
              Delete data from this device
            </button>
          )}
        </div>
      )}

      {!info && status !== 'starting' && status !== 'loading' && (
        <section className="panel data-help" aria-label="How to get your data">
          <h2>Getting your data here</h2>
          <ol>
            <li>On your Mac, in the project folder, run <span className="mono">make mobile-pack</span>.</li>
            <li>AirDrop <span className="mono">db/mazda.cx5pack</span> to this phone and save it in Files.</li>
            <li>Tap <b>Import data pack</b> and choose that file.</li>
          </ol>
          <p className="muted">
            The pack holds your vehicle's VIN: keep it private. Or try the app with synthetic
            <b> demo data</b> first.
          </p>
        </section>
      )}
    </>
  )
}
