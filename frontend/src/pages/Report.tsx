import { t } from '../i18n'
import { useEffect, useState } from 'react'
import {
  useAlerts, useCarWarnings, useDiagHistory, useDtcFrequency, useForecast, useFrameSummary, useOverview, useServiceLog,
  useTireForecast, useWarningFlags,
} from '../api/hooks'
import { FEW_FRAMES, hintLine } from '../frames'
import { useCurrentModel } from '../model'
import { useDateRange } from '../range'
import { REPORT_FOOTER, SECTION_IDS, SECTION_TITLE, buildReport, isEmpty, type Section, type SectionId } from '../report'
import { fmtDate } from '../lib'

/** What the freeze frames say about one fault, in the Faults page's own words (M36); nothing when it says nothing. */
function FrameLine({ ecu, code }: { ecu: string; code: string }) {
  const s = useFrameSummary(ecu, code).data
  if (!s || s.frames === 0) return null
  const hint = hintLine(s)
  return (
    <li>
      <b>{code}</b> ({ecu}): {hint ?? 'Nothing stands out in its freeze frames against the other faults.'}{' '}
      <span className="muted">
        {s.frames} frame{s.frames === 1 ? '' : 's'}{s.frames < FEW_FRAMES ? ': a hint, not a pattern' : ''}.
      </span>
    </li>
  )
}

function SectionView({ s }: { s: Section }) {
  return (
    <section className="report-section">
      <h2>{s.title}</h2>
      {isEmpty(s) && s.empty && <p className="muted">{s.empty}</p>}
      {s.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {s.table && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{s.table.head.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {s.table.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} style={{ whiteSpace: 'normal' }}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.faults && s.faults.length > 0 && (
        <ul className="report-frames">
          {s.faults.slice(0, 12).map((f) => (
            <FrameLine key={`${f.ecu}|${f.dtc_code}`} ecu={f.ecu} code={f.dtc_code} />
          ))}
          <li className="muted">Freeze frames describe the car at the moment a fault was recorded, set against the frames of its other faults; they do not say what caused it.</li>
        </ul>
      )}
    </section>
  )
}

/** A report for the mechanic (PLAN.md M54): one printable page made of what the other pages already show. */
export default function ReportPage() {
  const car = useCurrentModel()
  const period = useDateRange()
  const [include, setInclude] = useState<ReadonlySet<SectionId>>(new Set(SECTION_IDS))
  const [showVin, setShowVin] = useState(false)
  const input = {
    car: { id: car.id, name: car.name },
    period: { from: period.from, to: period.to },
    showVin,
    overview: useOverview().data,
    faults: useDtcFrequency().data,
    carWarnings: useCarWarnings().data,
    lamps: useWarningFlags().data,
    tireForecast: useTireForecast().data,
    forecast: useForecast().data,
    diagnostics: useDiagHistory().data,
    service: useServiceLog().data,
    alerts: useAlerts('new').data,
  }
  const sections = buildReport(input, include)
  // print in light colours whatever the theme on screen is, and put the theme back afterwards
  useEffect(() => {
    const root = document.documentElement
    let before: string | undefined
    const start = () => {
      before = root.dataset.theme
      root.dataset.theme = 'light'
    }
    const end = () => {
      if (before === undefined) delete root.dataset.theme
      else root.dataset.theme = before
    }
    window.addEventListener('beforeprint', start)
    window.addEventListener('afterprint', end)
    return () => {
      window.removeEventListener('beforeprint', start)
      window.removeEventListener('afterprint', end)
    }
  }, [])
  const toggle = (id: SectionId) =>
    setInclude((now) => {
      const next = new Set(now)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <div className="report">
      <div className="page-head no-print">
        <div>
          <h1>{t('page.report')}</h1>
          <p>A page to print or save as a PDF for the workshop: what the car reported, in the period chosen above.</p>
        </div>
        <div className="controls">
          <button type="button" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
      </div>
      <fieldset className="report-options no-print">
        <legend>What to include</legend>
        {SECTION_IDS.map((id) => (
          <label key={id} className="toggle">
            <input type="checkbox" checked={include.has(id)} onChange={() => toggle(id)} /> {SECTION_TITLE[id]}
          </label>
        ))}
        <label className="toggle">
          <input type="checkbox" checked={showVin} onChange={(e) => setShowVin(e.target.checked)} /> Show the VIN
        </label>
      </fieldset>
      <article className="report-page">
        <header>
          <h1>{car.name}: report for the workshop</h1>
          <p className="muted">Made on {fmtDate(new Date().toISOString())}</p>
        </header>
        {sections.map((s) => (
          <SectionView key={s.id} s={s} />
        ))}
        <footer className="muted">
          {REPORT_FOOTER.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </footer>
      </article>
    </div>
  )
}
