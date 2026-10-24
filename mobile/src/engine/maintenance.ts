/** The car's own oil-change countdown (port of `maintenance_oil` in `api/app.py`). A state: ignores the period. */
import type { Handler } from './context'
import { OIL_STEP } from './shapes'
import { pick } from './http'
import { pyRound } from './pyround'

export const maintenanceOil: Handler = async ({ con }) => {
  const latest = await con.one(
    'SELECT read_at, remaining_km, odometer_km, interval_started_at FROM v_oil_readings ORDER BY read_at DESC LIMIT 1',
  )
  const steps = await con.rows(
    'SELECT read_at, odometer_km, remaining_km, coalesce(remaining_km > previous_km, false) AS serviced ' +
      'FROM v_oil_readings WHERE previous_km IS DISTINCT FROM remaining_km ORDER BY read_at',
  )
  const newest = (await con.one('SELECT max(odometer_km) AS v FROM v_odometer_readings')).v as number | null
  const atReading = (latest.odometer_km ?? null) as number | null
  const has = Object.keys(latest).length > 0
  return {
    has_data: has,
    remaining_km: latest.remaining_km ?? null,
    read_at: latest.read_at ?? null,
    odometer_km: atReading,
    // Python: round(max(0.0, newest - at_reading), 1)
    km_since_reading: newest !== null && atReading !== null ? pyRound(Math.max(0, newest - atReading), 1) : null,
    interval_started_at: latest.interval_started_at ?? null,
    intervals: (await con.one('SELECT count(DISTINCT interval_no) AS n FROM v_oil_readings')).n,
    steps: steps.map((s) => pick(s, OIL_STEP)),
  }
}
