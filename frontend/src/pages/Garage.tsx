import { useGarageOf } from '../api/hooks'
import type { Garage as GarageCard } from '../api/types'
import { Panel } from '../components/ui'
import { FUEL_CAUTION, alertsLabel, costBlock, faultsLabel, fuelBlock, oilLine, staleNote } from '../garage'
import { fmtAgo, fmtDate, fmtNum } from '../lib'
import { useCurrentModel, useSwitchModel } from '../model'

type Car = { id: string; name: string; platform?: string | null }

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="garage-figure">
      <div className="muted cmp-name">{label}</div>
      <div className="garage-value">{value}</div>
      {sub && <div className="muted garage-sub">{sub}</div>}
    </div>
  )
}

function Card({ car, shown }: { car: Car; shown: boolean }) {
  const query = useGarageOf(car.id)
  const switchTo = useSwitchModel()
  const g: GarageCard | undefined = query.data
  const open = () => switchTo(car.id, '/')
  const stale = g?.has_data ? staleNote(g.last_reading_at) : null
  const fuel = g?.has_data ? fuelBlock(g) : null
  const cost = g?.has_data ? costBlock(g) : null

  return (
    <article className={`panel garage-card${shown ? ' shown' : ''}`} aria-label={car.name}>
      <div className="metric-head">
        <h3>{car.name}</h3>
        <span className="muted mono">{g?.vin ? `VIN …${g.vin.slice(-6)}` : ''}</span>
      </div>
      {query.isPending ? (
        <div className="skeleton" aria-busy="true" />
      ) : !g || !g.has_data ? (
        <div className="state">{query.isError ? (query.error as Error).message : 'No data for this car yet.'}</div>
      ) : (
        <>
          <div className="garage-badges">
            <span className={`badge ${g.alerts_new > 0 ? 'warning' : 'info'}`}>{alertsLabel(g.alerts_new)}</span>
            <span className={`badge ${g.active_faults > 0 ? 'critical' : 'info'}`}>{faultsLabel(g.active_faults)}</span>
            {g.car_warnings_on.map((label) => (
              <span key={label} className="badge critical" title="One of the car's own warning flags is on">
                car warning: {label}
              </span>
            ))}
          </div>
          {stale && <div className="caveat garage-stale">{stale}</div>}
          <div className="garage-figures">
            <Figure label="Odometer" value={`${fmtNum(g.odometer_km)} km`} sub={g.odometer_at ? `as of ${fmtDate(g.odometer_at)}` : undefined} />
            <Figure
              label="Last 30 days"
              value={`${fmtNum(g.km_last_30_days)} km`}
              sub={g.from_day && g.to_day ? `${fmtDate(g.from_day)} – ${fmtDate(g.to_day)}` : undefined}
            />
            {fuel && <Figure label="Fuel used, last 30 days" value={fuel.value} sub={fuel.sub} />}
            {cost && <Figure label="Fuel cost, last 30 days" value={cost.value} sub={cost.sub} />}
            <Figure label="Fuel level" value={`${fmtNum(g.fuel_level_pct)} %`} sub={g.range_km != null ? `range ≈ ${fmtNum(g.range_km)} km` : undefined} />
            <Figure label="Next oil change" value={oilLine(g)} sub={g.oil_read_at ? `as reported ${fmtDate(g.oil_read_at)}` : undefined} />
            <Figure label="Last reading" value={fmtAgo(g.last_reading_at)} />
          </div>
          <button type="button" onClick={open}>
            {shown ? 'Open the overview' : `Show ${car.name}`}
          </button>
        </>
      )}
    </article>
  )
}

export default function Garage() {
  const { models, id: current } = useCurrentModel()
  const cars = models.filter((m) => m.has_data)
  return (
    <>
      <div className="page-head">
        <div>
          <h1>All cars</h1>
          <p>
            The headline figures of every car at a glance. The distance is for the 30 days up to each car&apos;s newest data; alerts,
            faults, the oil countdown and the car&apos;s own warnings are the latest.
          </p>
          <p className="muted garage-caution">{FUEL_CAUTION}</p>
        </div>
      </div>
      {cars.length === 0 ? (
        <Panel>
          <div className="state">No car has data yet.</div>
        </Panel>
      ) : (
        <div className="cards">
          {cars.map((m) => (
            <Card key={m.id} car={m} shown={m.id === current} />
          ))}
        </div>
      )}
    </>
  )
}
