import { Route, Routes, useLocation } from 'react-router-dom'
import { useOverview } from './api/hooks'
import { DateRangeBar } from './components/DateRangeBar'
import { ThemeToggle } from './components/ThemeToggle'
import { RangeNavLink as NavLink } from './components/RangeLink'
import { useRestoreSavedRange } from './range'
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
  useRestoreSavedRange()
  const o = overview.data
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <Logo />
          <div>
            CX-5
            <small>TELEMETRY</small>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/trends">Trends</NavLink>
          <NavLink to="/alerts">
            Alerts{o && o.alerts_new > 0 && <span className="count">{o.alerts_new}</span>}
          </NavLink>
          <NavLink to="/warnings">Warnings</NavLink>
          <NavLink to="/faults">
            Faults{o && o.active_faults > 0 && <span className="count">{o.active_faults}</span>}
          </NavLink>
          <NavLink to="/status">Status</NavLink>
          <NavLink to="/diagnostics">Diagnostics</NavLink>
        </nav>
        <div className="rail-foot">
          <ThemeToggle />
          {o?.vin && <div className="vin">VIN …{o.vin.slice(-6)}</div>}
        </div>
      </aside>
      <main className="main">
        {PERIOD_PAGES.includes(pathname) && <DateRangeBar />}
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/warnings" element={<Warnings />} />
          <Route path="/faults" element={<Faults />} />
          <Route path="/status" element={<Status />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="*" element={<div className="state">Page not found</div>} />
        </Routes>
      </main>
    </div>
  )
}
