/**
 * How the car is driven (port of `api/driving.py`, PLAN.md M48): the stretches of driving of `v_trip_segments`
 * (between two consecutive status reports) by length. The SQL is the Python route's: keep the two identical.
 * A stretch whose reports are GAP_HOURS or more apart is in no band; the month totals count every stretch.
 */
import type { Handler } from './context'
import { pick } from './http'
import { DRIVING_BAND, DRIVING_BAND_TOTAL } from './shapes'

const GAP_HOURS = 48
const MIN_KM = 20
// name, from km, up to km: a stretch of exactly 5 km is in the second band
const BANDS: [string, number, number | null][] = [
  ['under_5', 0, 5],
  ['5_to_20', 5, 20],
  ['20_to_100', 20, 100],
  ['over_100', 100, null],
]

const BAND_SQL =
  "CASE WHEN km < 5 THEN 'under_5' WHEN km < 20 THEN '5_to_20' WHEN km < 100 THEN '20_to_100' " + "ELSE 'over_100' END"
const MONTH_SQL = "strftime(date_trunc('month', end_at), '%Y-%m')"
const FIGURES =
  'count(*) AS stretches, round(coalesce(sum(km), 0), 1) AS km, round(coalesce(sum(fuel_l), 0), 2) AS fuel_l, ' +
  `CASE WHEN sum(km) >= ${MIN_KM} THEN round(100 * sum(fuel_l) / sum(km), 2) END AS l_per_100km`
const SPEED =
  'round(coalesce(sum(driving_seconds), 0) / 3600.0, 1) AS driving_hours, ' +
  `CASE WHEN sum(km) >= ${MIN_KM} THEN round(sum(km) / nullif(sum(driving_seconds) / 3600.0, 0), 1) END ` +
  'AS avg_speed_kmh'

type Row = Record<string, unknown>
const and = (where: string, cond: string) => (where ? `${where} AND ${cond}` : `WHERE ${cond}`)

/** Always the four bands, in order; one nobody drove has zeros. */
function bands(found: Map<string, Row>, extra: Row, fields: string[]): Row[] {
  const empty = { stretches: 0, km: 0, fuel_l: 0, l_per_100km: null }
  return BANDS.map(([band, min_km, max_km]) => pick({ band, min_km, max_km, ...empty, ...extra, ...(found.get(band) ?? {}) }, fields))
}

export const drivingPattern: Handler = async ({ con, range }) => {
  const { sql: where, params } = range().clause('end_at')
  const close = and(where, `gap_hours < ${GAP_HOURS}`)
  const total = await con.one(`SELECT ${FIGURES}, ${SPEED} FROM v_trip_segments ${close}`, params)
  const apart = await con.one(
    'SELECT count(*) AS stretches, round(coalesce(sum(km), 0), 1) AS km FROM v_trip_segments ' + and(where, `gap_hours >= ${GAP_HOURS}`),
    params,
  )
  const byBand = await con.rows(`SELECT ${BAND_SQL} AS band, ${FIGURES}, ${SPEED} FROM v_trip_segments ${close} GROUP BY 1 ORDER BY 1`, params)
  const months = await con.rows(`SELECT ${MONTH_SQL} AS month, ${FIGURES} FROM v_trip_segments ${where} GROUP BY 1 ORDER BY 1`, params)
  const monthBands = await con.rows(
    `SELECT ${MONTH_SQL} AS month, ${BAND_SQL} AS band, ${FIGURES} FROM v_trip_segments ${close} ` + 'GROUP BY 1, 2 ORDER BY 1, 2',
    params,
  )
  const perMonth = new Map<string, Map<string, Row>>()
  for (const r of monthBands) {
    const month = r.month as string
    if (!perMonth.has(month)) perMonth.set(month, new Map())
    perMonth.get(month)!.set(r.band as string, r)
  }
  return {
    gap_hours: GAP_HOURS,
    min_km: MIN_KM,
    stretches: total.stretches,
    km: total.km,
    fuel_l: total.fuel_l,
    l_per_100km: total.l_per_100km ?? null,
    driving_hours: total.driving_hours,
    avg_speed_kmh: total.avg_speed_kmh ?? null,
    unclassified: { stretches: apart.stretches, km: apart.km },
    bands: bands(new Map(byBand.map((r) => [r.band as string, r])), { driving_hours: 0, avg_speed_kmh: null }, DRIVING_BAND_TOTAL),
    months: months.map((mo) => ({
      month: mo.month,
      stretches: mo.stretches,
      km: mo.km,
      fuel_l: mo.fuel_l,
      l_per_100km: mo.l_per_100km ?? null,
      bands: bands(perMonth.get(mo.month as string) ?? new Map(), {}, DRIVING_BAND),
    })),
  }
}
