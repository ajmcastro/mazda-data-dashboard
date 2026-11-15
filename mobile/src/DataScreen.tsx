import { LangControl } from '@frontend/components/LangControl'
import { UnitsControl } from '@frontend/components/UnitsControl'
import { locale, t, tr } from '@frontend/i18n'
import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { saveModelChoice } from '@frontend/model'
import type { ModelPack } from './controller'
import { useController, useData } from './data'
import { phoneText } from './messages'
import { usePwa } from './pwa'

const fmtBytes = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })

export default function DataScreen() {
  const controller = useController()
  const { status, message, info, current, packs, error, persisted, lost } = useData()
  const [, setParams] = useSearchParams()
  const pwa = usePwa()
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

  /** The address follows the model that is loaded now (it may have changed when the one shown was deleted). */
  function showLoadedModel() {
    const id = controller.getState().current
    if (id) saveModelChoice(id)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('model')
      next.delete('report')
      next.delete('compare')
      return next
    }, { replace: true })
  }

  async function remove(pack: ModelPack) {
    if (!window.confirm(tr('Delete {name} from this device? You can import its data pack again at any time.', { name: pack.name }))) return
    setBusy(true)
    try {
      await controller.deleteModel(pack.id)
      showLoadedModel()
    } finally {
      setBusy(false)
    }
  }

  async function removeAll() {
    if (!window.confirm(tr('Delete all data (every car model) from this device? You can import the data packs again at any time.'))) return
    setBusy(true)
    try {
      await controller.deleteAll()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('page.data')}</h1>
          <p>{tr('Everything stays on this device: the app never sends your data anywhere.')}</p>
        </div>
      </div>

      {working && (
        <div className="state" role="status">
          {message ? phoneText(message) : tr('Working…')}
        </div>
      )}

      {error && (
        <div className="state error" role="alert">
          {phoneText(error)}
          <button type="button" className="linklike" onClick={() => controller.clearError()}>{tr('Dismiss')}</button>
        </div>
      )}

      {!info && lost && status !== 'starting' && status !== 'loading' && (
        <section className="panel data-lost" role="status" aria-label={tr('Data removed')}>
          <h2>{tr('Your data is no longer on this phone')}</h2>
          <p>
            {tr('The browser removed')} <b>{lost.name === 'demo' ? tr('the demo data') : lost.name}</b> {tr('(data up to {day}).', { day: fmtDay(lost.lastDay) })}{' '}
            {tr('iOS does this to web apps that are not opened for a while or when space runs low. Import the pack again: your')}{' '}
            <span className="mono">.cx5pack</span> {tr('file in Files is the real copy of your data.')}
          </p>
        </section>
      )}

      {packs.map((pack) => (
        <section key={pack.id} className="panel data-info" aria-label={tr('Data pack: {name}', { name: pack.name })}>
          <h2>
            {pack.name}
            {pack.info.name === 'demo' && ` ${tr('(demo data, synthetic)')}`}
            {packs.length > 1 && pack.id === current && <span className="muted"> · {tr('shown')}</span>}
          </h2>
          <dl>
            <dt>{tr('File')}</dt>
            <dd>{pack.info.name === 'demo' ? tr('demo') : pack.info.name}</dd>
            <dt>{tr('Data')}</dt>
            <dd>{tr('from {from} to {to}', { from: fmtDay(pack.info.manifest.first_data_day), to: fmtDay(pack.info.manifest.last_data_day) })}</dd>
            <dt>{tr('Pack created')}</dt>
            <dd>{fmtWhen(pack.info.manifest.created_at)}</dd>
            <dt>{tr('Imported')}</dt>
            <dd>{fmtWhen(pack.info.savedAt)}</dd>
            <dt>{tr('Size')}</dt>
            <dd>{fmtBytes(pack.info.bytes)}</dd>
          </dl>
          <button type="button" className="button danger" disabled={working} onClick={() => void remove(pack)}>
            {tr('Delete {name} from this device', { name: pack.name })}
          </button>
        </section>
      ))}

      {info && (
        <section className="panel data-info" aria-label={tr('Storage')}>
          <h2>{tr('Storage')}</h2>
          <dl>
            <dt>{tr('Kept by the browser')}</dt>
            <dd>{persisted === null ? tr('unknown') : persisted ? tr('yes') : tr('not guaranteed')}</dd>
            <dt>{tr('Works offline')}</dt>
            <dd>{!pwa.supported ? tr('only in the installed build') : pwa.offlineReady ? tr('yes') : tr('saving the app…')}</dd>
          </dl>
          {persisted !== true && (
            <p className="muted">
              {tr('The browser may remove this data if the phone runs low on space. Keep the')}{' '}
              <span className="mono">.cx5pack</span> {tr('files (in Files or iCloud Drive) so you can import them again.')}
            </p>
          )}
        </section>
      )}

      {status !== 'starting' && (
        <section className="panel units-panel">
          <div className="panel-head"><h2>{tr('Units and language')}</h2><span className="hint">{tr('how figures and text are shown on this phone')}</span></div>
          <UnitsControl />
          <LangControl />
        </section>
      )}

      {status !== 'starting' && (
        <div className="data-actions">
          <label className={`button primary${working ? ' disabled' : ''}`}>
            {info ? tr('Add or replace a data pack') : tr('Import data pack')}
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
              {tr('Load demo data')}
            </button>
          )}
          {packs.length > 1 && (
            <button type="button" className="button danger" disabled={working} onClick={() => void removeAll()}>
              {tr('Delete all data from this device')}
            </button>
          )}
        </div>
      )}

      {!info && status !== 'starting' && status !== 'loading' && (
        <section className="panel data-help" aria-label={tr('How to get your data')}>
          <h2>{tr('Getting your data here')}</h2>
          <ol>
            <li>{tr('On your Mac, in the project folder, run')} <span className="mono">make mobile-pack</span>.</li>
            <li>{tr('AirDrop')} <span className="mono">db/&lt;model&gt;.cx5pack</span> ({tr('for example')} <span className="mono">db/cx5.cx5pack</span>) {tr('to this phone and save it in Files.')}</li>
            <li>{tr('Tap')} <b>{tr('Import data pack')}</b> {tr('and choose that file. Each car model has its own pack: import each one, then switch between them at the top of the screen.')}</li>
          </ol>
          <p className="muted">
            {tr("A pack holds your vehicle's VIN: keep it private. Or first try the app with synthetic")}{' '}
            <b>{tr('demo data')}</b> {tr('(two demo cars).')}
          </p>
        </section>
      )}
    </>
  )
}
