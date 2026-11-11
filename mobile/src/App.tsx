import { useEffect, type ReactNode } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useOverview } from '@frontend/api/hooks'
import { DateRangeBar } from '@frontend/components/DateRangeBar'
import { ModelGate } from '@frontend/components/ModelGate'
import { ModelSwitcher } from '@frontend/components/ModelSwitcher'
import { RangeNavLink } from '@frontend/components/RangeLink'
import { ThemeCycleButton } from '@frontend/components/ThemeToggle'
import Alerts from '@frontend/pages/Alerts'
import Diagnostics from '@frontend/pages/Diagnostics'
import Faults from '@frontend/pages/Faults'
import OverviewPage from '@frontend/pages/Overview'
import Status from '@frontend/pages/Status'
import Trends from '@frontend/pages/Trends'
import Warnings from '@frontend/pages/Warnings'
import { isPageHidden } from '@frontend/lib'
import { useCurrentModel } from '@frontend/model'
import { useRangeSearch, useRestoreSavedRange } from '@frontend/range'
import CompareGate from './CompareGate'
import DataScreen from './DataScreen'
import { useController, useData } from './data'
import { applyUpdate, usePwa } from './pwa'

// Pages about a period get the date-range bar (same list as the Mac app)
const PERIOD_PAGES = ['/', '/trends', '/warnings', '/faults', '/status']

function More({ hidden, canCompare }: { hidden: readonly string[] | undefined; canCompare: boolean }) {
  const link = (to: string, label: string) => (isPageHidden(to, hidden) ? null : <RangeNavLink to={to}>{label}</RangeNavLink>)
  return (
    <>
      <div className="page-head"><h1>More</h1></div>
      <nav className="more-list" aria-label="More pages">
        {link('/warnings', 'Warnings')}
        {link('/status', 'Status')}
        {canCompare && <RangeNavLink to="/compare">Compare cars</RangeNavLink>}
        {isPageHidden('/diagnostics', hidden) ? null : <RangeNavLink to="/diagnostics">Diagnostics</RangeNavLink>}
        <NavLink to="/data">Data on this phone</NavLink>
      </nav>
    </>
  )
}

function Ready() {
  const overview = useOverview()
  const { pathname } = useLocation()
  const search = useRangeSearch()
  const { model, models } = useCurrentModel()
  useRestoreSavedRange()
  // two cars that have data and show the Trends page can be compared
  const canCompare = models.filter((m) => m.has_data && !isPageHidden('/trends', m.hidden_pages)).length >= 2
  const o = overview.data
  const hidden = model?.hidden_pages
  const tab = (to: string, label: ReactNode) =>
    isPageHidden(to, hidden) ? null : <RangeNavLink to={to} end={to === '/'}>{label}</RangeNavLink>
  // a page the model hides sends you to the overview instead of showing nothing
  const page = (path: string, element: ReactNode) => (
    <Route path={path} element={isPageHidden(path, hidden) ? <Navigate to={{ pathname: '/', search }} replace /> : element} />
  )
  const moreActive = ['/more', '/warnings', '/status', '/diagnostics', '/compare', '/data'].includes(pathname)
  return (
    <div className="m-shell">
      <main className="main">
        <div className="m-model"><ModelSwitcher /></div>
        {PERIOD_PAGES.includes(pathname) && <DateRangeBar />}
        <ModelGate>
          <Routes>
            {page('/', <OverviewPage />)}
            {page('/trends', <Trends />)}
            {page('/alerts', <Alerts />)}
            {page('/faults', <Faults />)}
            {page('/warnings', <Warnings />)}
            {page('/status', <Status />)}
            {page('/diagnostics', <Diagnostics />)}
            <Route path="/compare" element={<CompareGate />} />
            <Route path="/data" element={<DataScreen />} />
            <Route path="/more" element={<More hidden={hidden} canCompare={canCompare} />} />
            <Route path="*" element={<div className="state">Page not found</div>} />
          </Routes>
        </ModelGate>
      </main>
      <nav className="tabbar" aria-label="Main">
        {tab('/', 'Overview')}
        {tab('/trends', 'Trends')}
        {tab('/alerts', <>Alerts{o && o.alerts_new > 0 && <span className="count">{o.alerts_new}</span>}</>)}
        {tab('/faults', <>Faults{o && o.active_faults > 0 && <span className="count">{o.active_faults}</span>}</>)}
        <NavLink to="/more" className={moreActive ? 'active' : undefined}>More</NavLink>
        <ThemeCycleButton className="tab-theme" />
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

/**
 * The address decides which model is shown (`?model=`, none = the one loaded): when it names another stored
 * model, that pack is loaded into the engine. Importing a pack never changes the address, so the two
 * cannot disagree for long.
 */
function useFollowTheAddress() {
  const controller = useController()
  const { status, current, preparing } = useData()
  const { model } = useCurrentModel()
  useEffect(() => {
    // not while the comparison is being prepared: the engine passes through the other cars on purpose
    if (status === 'ready' && !preparing && model && model.id !== current) void controller.switchTo(model.id)
  }, [controller, status, current, preparing, model])
}

export default function MobileApp() {
  const { status } = useData()
  useFollowTheAddress()
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
