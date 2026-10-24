import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useOverview } from '@frontend/api/hooks'
import { DateRangeBar } from '@frontend/components/DateRangeBar'
import { RangeNavLink } from '@frontend/components/RangeLink'
import Alerts from '@frontend/pages/Alerts'
import Diagnostics from '@frontend/pages/Diagnostics'
import Faults from '@frontend/pages/Faults'
import OverviewPage from '@frontend/pages/Overview'
import Status from '@frontend/pages/Status'
import Trends from '@frontend/pages/Trends'
import Warnings from '@frontend/pages/Warnings'
import { useRestoreSavedRange } from '@frontend/range'
import DataScreen from './DataScreen'
import { useData } from './data'
import { applyUpdate, usePwa } from './pwa'

// Pages about a period get the date-range bar (same list as the Mac app)
const PERIOD_PAGES = ['/', '/trends', '/warnings', '/faults', '/status']

function More() {
  return (
    <>
      <div className="page-head"><h1>More</h1></div>
      <nav className="more-list" aria-label="More pages">
        <RangeNavLink to="/warnings">Warnings</RangeNavLink>
        <RangeNavLink to="/status">Status</RangeNavLink>
        <NavLink to="/diagnostics">Diagnostics</NavLink>
        <NavLink to="/data">Data on this phone</NavLink>
      </nav>
    </>
  )
}

function Ready() {
  const overview = useOverview()
  const { pathname } = useLocation()
  useRestoreSavedRange()
  const o = overview.data
  const moreActive = ['/more', '/warnings', '/status', '/diagnostics', '/data'].includes(pathname)
  return (
    <div className="m-shell">
      <main className="main">
        {PERIOD_PAGES.includes(pathname) && <DateRangeBar />}
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/faults" element={<Faults />} />
          <Route path="/warnings" element={<Warnings />} />
          <Route path="/status" element={<Status />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/data" element={<DataScreen />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<div className="state">Page not found</div>} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Main">
        <RangeNavLink to="/" end>Overview</RangeNavLink>
        <RangeNavLink to="/trends">Trends</RangeNavLink>
        <RangeNavLink to="/alerts">
          Alerts{o && o.alerts_new > 0 && <span className="count">{o.alerts_new}</span>}
        </RangeNavLink>
        <RangeNavLink to="/faults">
          Faults{o && o.active_faults > 0 && <span className="count">{o.active_faults}</span>}
        </RangeNavLink>
        <NavLink to="/more" className={moreActive ? 'active' : undefined}>More</NavLink>
      </nav>
    </div>
  )
}

function UpdateBanner() {
  const { updateReady } = usePwa()
  if (!updateReady) return null
  return (
    <div className="update-banner" role="status">
      A new version of the app is ready.
      <button type="button" className="button primary" onClick={applyUpdate}>Update</button>
    </div>
  )
}

export default function MobileApp() {
  const { status } = useData()
  return (
    <>
      <UpdateBanner />
      {status !== 'ready' ? (
        <div className="m-shell">
          <main className="main"><DataScreen /></main>
        </div>
      ) : (
        <Ready />
      )}
    </>
  )
}
