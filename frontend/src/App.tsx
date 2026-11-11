import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useOverview } from './api/hooks'
import { DateRangeBar } from './components/DateRangeBar'
import { ThemeToggle } from './components/ThemeToggle'
import { RangeNavLink as NavLink } from './components/RangeLink'
import { ModelGate } from './components/ModelGate'
import { ModelSwitcher } from './components/ModelSwitcher'
import { isPageHidden, shortModelName } from './lib'
import { useCurrentModel, useRestoreSavedModel } from './model'
import { useRangeSearch, useRestoreSavedRange } from './range'
import Alerts from './pages/Alerts'
import Diagnostics from './pages/Diagnostics'
import Faults from './pages/Faults'
import OverviewPage from './pages/Overview'
import Status from './pages/Status'
import Trends from './pages/Trends'
import Warnings from './pages/Warnings'

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 23a11 11 0 1 1 22 0" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 23l5.5-9" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="16" cy="23" r="2.2" fill="var(--text)" />
    </svg>
  )
}

// Pages about a period get the date-range bar; alerts and the diagnostic-tool report are not
// tied to a period.
const PERIOD_PAGES = ['/', '/trends', '/warnings', '/faults', '/status']

export default function App() {
  const overview = useOverview()
  const { pathname } = useLocation()
  const search = useRangeSearch()
  const { id, name, model } = useCurrentModel()
  useRestoreSavedRange(useRestoreSavedModel())
  useEffect(() => {
    document.title = `${name} Telemetry`
  }, [name])
  const o = overview.data
  const hidden = model?.hidden_pages
  const nav = (to: string, label: ReactNode) =>
    isPageHidden(to, hidden) ? null : (
      <NavLink to={to} end={to === '/'}>{label}</NavLink>
    )
  // a page the model hides sends you to the overview instead of showing nothing
  const page = (path: string, element: ReactNode) => (
    <Route
      path={path}
      element={isPageHidden(path, hidden) ? <Navigate to={{ pathname: '/', search }} replace /> : element}
    />
  )
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <Logo />
          <div>
            {shortModelName(name)}
            <small>TELEMETRY</small>
          </div>
        </div>
        <ModelSwitcher />
        <nav className="nav" aria-label="Main">
          {nav('/', 'Overview')}
          {nav('/trends', 'Trends')}
          {nav('/alerts', <>Alerts{o && o.alerts_new > 0 && <span className="count">{o.alerts_new}</span>}</>)}
          {nav('/warnings', 'Warnings')}
          {nav('/faults', <>Faults{o && o.active_faults > 0 && <span className="count">{o.active_faults}</span>}</>)}
          {nav('/status', 'Status')}
          {nav('/diagnostics', 'Diagnostics')}
        </nav>
        <div className="rail-foot">
          <ThemeToggle />
          {o?.vin && <div className="vin">VIN …{o.vin.slice(-6)}</div>}
        </div>
      </aside>
      <main className="main">
        {PERIOD_PAGES.includes(pathname) && <DateRangeBar />}
        <ModelGate>
          {/* keyed by the model: everything a page remembers (a chosen fault, a flag) belongs to one model */}
          <Routes key={id}>
            {page('/', <OverviewPage />)}
            {page('/trends', <Trends />)}
            {page('/alerts', <Alerts />)}
            {page('/warnings', <Warnings />)}
            {page('/faults', <Faults />)}
            {page('/status', <Status />)}
            {page('/diagnostics', <Diagnostics />)}
            <Route path="*" element={<div className="state">Page not found</div>} />
          </Routes>
        </ModelGate>
      </main>
    </div>
  )
}
