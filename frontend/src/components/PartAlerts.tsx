import { alertsText, type Part } from '../car'
import { RangeLink } from './RangeLink'

/** The marker of a part that has open alerts: their number, and a link to the Alerts page filtered to the part (M55). */
export function PartAlerts({ part }: { part: Part }) {
  if (!part.alerts) return null
  return (
    <div className="car-part-note">
      <RangeLink to="/alerts" extra={{ part: part.id }} className="car-part-alerts">{alertsText(part.alerts)} →</RangeLink>
    </div>
  )
}
