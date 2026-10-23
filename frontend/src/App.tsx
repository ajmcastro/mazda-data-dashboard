import { NavLink, Route, Routes } from 'react-router-dom'
import { useOverview } from './api/hooks'
import Faults from './pages/Faults'
import OverviewPage from './pages/Overview'
import Status from './pages/Status'
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

export default function App() {
  const overview = useOverview()
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
          <NavLink to="/warnings">Warnings</NavLink>
          <NavLink to="/faults">
            Faults{o && o.active_faults > 0 && <span className="count">{o.active_faults}</span>}
          </NavLink>
          <NavLink to="/status">Status</NavLink>
        </nav>
        <div className="rail-foot">{o?.vin ? `VIN …${o.vin.slice(-6)}` : ''}</div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/warnings" element={<Warnings />} />
          <Route path="/faults" element={<Faults />} />
          <Route path="/status" element={<Status />} />
          <Route path="*" element={<div className="state">Page not found</div>} />
        </Routes>
      </main>
    </div>
  )
}
