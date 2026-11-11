/** One car's headline figures for the "All cars" page (port of `garage` in `api/app.py`). */
import type { Handler } from './context'
import { addDays, DateRange } from './dates'
import { Query, pick } from './http'
import { carWarnings } from './carwarnings'
import { maintenanceOil } from './maintenance'
import { pyRound } from './pyround'
import { GARAGE } from './shapes'
import { overview, span } from './series'

/** The litres and the cost of the overview's period, as estimates: the distance (odometer) times the average
 * consumption, and times the cost per 100 km (which needs a fuel price). Same as `_fuel_and_cost` in api/app.py. */
function fuelAndCost(ov: Record<string, any>): Record<string, unknown> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Record<string, unknown> = {}
  const km = ov.km_in_range as number | null
  const l100 = ov.l_per_100km_in_range as number | null
  const cost100 = ov.cost_per_100km_in_range as number | null
  if (l100 !== null && l100 !== undefined) {
    out.l_per_100km_30d = pyRound(l100, 2)
    if (km !== null && km !== undefined) out.fuel_l_30d = pyRound((km * l100) / 100, 1)
  }
  if (cost100 !== null && cost100 !== undefined && ov.currency) {
    out.cost_per_100km_30d = pyRound(cost100, 2)
    out.currency = ov.currency
    if (km !== null && km !== undefined) out.fuel_cost_30d = pyRound((km * cost100) / 100, 2)
  }
  return out
}

export const garage: Handler = async (ctx) => {
  const s = (await span(ctx)) as { first_day: string | null; last_day: string | null }
  if (!s.last_day) return pick({ has_data: false, alerts_new: 0, active_faults: 0, car_warnings_on: [] }, GARAGE)
  // the 30 days up to the newest day with data, never before the first day
  const back = addDays(s.last_day, -29)
  const first = s.first_day && s.first_day > back ? s.first_day : back
  const range = new DateRange(first, s.last_day)
  const ov = (await overview({ ...ctx, q: new Query(new URLSearchParams()), range: () => range })) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const oil = (await maintenanceOil(ctx)) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const flags = (await carWarnings(ctx)) as { flags: { label: string; is_on: boolean }[] }
  return pick(
    {
      has_data: true,
      vin: ov.vin,
      odometer_km: ov.odometer_km,
      odometer_at: ov.odometer_at,
      last_reading_at: ov.data_to,
      from_day: first,
      to_day: s.last_day,
      km_last_30_days: ov.km_in_range,
      ...fuelAndCost(ov),
      fuel_level_pct: ov.status?.fuel_level_pct ?? null,
      range_km: ov.status?.range_km ?? null,
      oil_remaining_km: oil.remaining_km,
      oil_read_at: oil.read_at,
      alerts_new: ov.alerts_new,
      active_faults: ov.active_faults,
      car_warnings_on: flags.flags.filter((f) => f.is_on).map((f) => f.label),
    },
    GARAGE,
  )
}
