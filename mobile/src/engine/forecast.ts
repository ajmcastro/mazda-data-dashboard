/**
 * Maintenance and mileage forecast (port of `backend/src/mazda_dash/forecast.py` and its route, PLAN.md M52):
 * the pace of the last 30 and 90 days, the oil change as two dates and the year's distance against a limit,
 * all counted from the newest day with data. The SQL is the Python module's, built the same way: keep the two
 * identical.
 */
import type { Handler } from './context'
import { pick } from './http'
import { FORECAST } from './shapes'

const MIN_PACE = '1.0'
const MAX_DAYS = 730
const ZONE = "coalesce((SELECT max(value) FILTER (WHERE key = 'car_timezone') FROM ref_settings), 'UTC')"

const window = (days: number): string =>
  `p${days} AS (SELECT (SELECT min(o.read_at) FROM o WHERE o.read_at >= n.t - INTERVAL ${days} DAY) AS from_t, ` +
  `(SELECT arg_min(o.odometer_km, o.read_at) FROM o WHERE o.read_at >= n.t - INTERVAL ${days} DAY) AS from_km ` +
  'FROM n), ' +
  `q${days} AS (SELECT CASE WHEN date_diff('second', p.from_t, n.t) / 86400.0 >= ${days / 2} ` +
  `THEN (n.km - p.from_km) / (date_diff('second', p.from_t, n.t) / 86400.0) END AS pace FROM p${days} p, n), `

/** Days until the oil change at a pace (NULL without a pace worth a date, or beyond MAX_DAYS). */
const daysAt = (pace: string): string =>
  `CASE WHEN ${pace} >= ${MIN_PACE} AND oil.left_km IS NOT NULL AND oil.left_km / ${pace} <= ${MAX_DAYS} ` +
  `THEN CAST(ceil(oil.left_km / ${pace}) AS INTEGER) END`

export const FORECAST_SQL =
  'WITH o AS (SELECT read_at, odometer_km FROM v_odometer_readings WHERE odometer_km IS NOT NULL), ' +
  'n AS (SELECT max(read_at) AS t, arg_max(odometer_km, read_at) AS km, ' +
  `CAST(timezone(${ZONE}, make_timestamptz(epoch_us(max(read_at)))) AS DATE) AS day FROM o), ` +
  window(30) +
  window(90) +
  'latest AS (SELECT remaining_km, odometer_km FROM v_oil_readings ORDER BY read_at DESC LIMIT 1), ' +
  'oil AS (SELECT (SELECT greatest(l.remaining_km - greatest(n.km - coalesce(l.odometer_km, n.km), 0), 0) ' +
  'FROM latest l) AS left_km FROM n), ' +
  `d AS (SELECT ${daysAt('q30.pace')} AS d30, ${daysAt('q90.pace')} AS d90 FROM oil, q30, q90), ` +
  "cfg AS (SELECT try_cast(max(value) FILTER (WHERE key = 'mileage_limit_km') AS DOUBLE) AS limit_km, " +
  "try_cast(max(value) FILTER (WHERE key = 'mileage_start') AS DATE) AS start FROM ref_settings), " +
  'y AS (SELECT c.limit_km, CASE WHEN c.start IS NOT NULL AND n.day >= c.start ' +
  "THEN CAST(c.start + to_years(CAST(date_sub('year', c.start, n.day) AS INTEGER)) AS DATE) END AS a, " +
  'CASE WHEN c.start IS NOT NULL AND n.day >= c.start ' +
  "THEN CAST(c.start + to_years(CAST(date_sub('year', c.start, n.day) AS INTEGER) + 1) AS DATE) END AS e " +
  'FROM cfg c, n), ' +
  'ys AS (SELECT (SELECT arg_min(o.odometer_km, o.read_at) FROM o WHERE CAST(timezone(' +
  `${ZONE}, make_timestamptz(epoch_us(o.read_at))) AS DATE) >= y.a) AS km0, ` +
  `(SELECT min(CAST(timezone(${ZONE}, make_timestamptz(epoch_us(o.read_at))) AS DATE)) FROM o ` +
  `WHERE CAST(timezone(${ZONE}, make_timestamptz(epoch_us(o.read_at))) AS DATE) >= y.a) AS day0 FROM y), ` +
  'r AS (SELECT n.day, n.km, q30.pace AS p30, q90.pace AS p90, coalesce(q90.pace, q30.pace) AS pace, ' +
  'oil.left_km, least(d.d30, d.d90) AS first_days, greatest(d.d30, d.d90) AS last_days, ' +
  'y.limit_km, y.a, y.e, ys.km0, ys.day0 FROM n, q30, q90, oil, d, y, ys) ' +
  "SELECT strftime(day, '%Y-%m-%d') AS as_of, round(km, 1) AS odometer_km, " +
  'round(p30, 1) AS km_per_day_30d, round(p90, 1) AS km_per_day_90d, ' +
  'CAST(round(pace * 365, -2) AS INTEGER) AS km_per_year, ' +
  'round(left_km, 0) AS oil_left_km, first_days AS oil_days_first, last_days AS oil_days_last, ' +
  "strftime(day + first_days, '%Y-%m-%d') AS oil_date_first, " +
  "strftime(day + last_days, '%Y-%m-%d') AS oil_date_last, " +
  "limit_km AS mileage_limit_km, strftime(a, '%Y-%m-%d') AS year_start, strftime(e, '%Y-%m-%d') AS year_end, " +
  'CASE WHEN a IS NOT NULL THEN round(km - km0, 0) END AS year_km, ' +
  "CASE WHEN day0 > a + 7 THEN strftime(day0, '%Y-%m-%d') END AS year_counted_from, " +
  'CASE WHEN a IS NOT NULL AND pace IS NOT NULL ' +
  "THEN CAST(round(km - km0 + pace * date_diff('day', day, e), -2) AS INTEGER) END AS year_projected_km, " +
  'CASE WHEN a IS NOT NULL AND pace IS NOT NULL AND limit_km IS NOT NULL ' +
  "THEN CAST(round(km - km0 + pace * date_diff('day', day, e), -2) - limit_km AS INTEGER) END AS year_over_km " +
  'FROM r WHERE day IS NOT NULL'

export const forecast: Handler = async ({ con }) => {
  const rows = await con.rows(FORECAST_SQL)
  return { has_data: rows.length > 0, ...pick(rows[0] ?? {}, FORECAST) }
}
