/**
 * Tire leak forecast (port of `backend/src/mazda_dash/tires.py` and the route in `api/app.py`, PLAN.md M51).
 * Per wheel, the slope of its difference from the mean of the other three over the last WINDOW_DAYS (a
 * Theil-Sen estimate in SQL), and when its own pressure reaches the limit at that rate. The SQL is the Python
 * module's, built the same way: keep the two identical.
 */
import type { Handler } from './context'
import { pick } from './http'
import { WHEEL_FORECAST } from './shapes'

const WINDOW_DAYS = 30
const MIN_READINGS = 8
const MIN_SPAN_DAYS = 10
const REFILL_KPA = 25
const REFILL_AGAINST_KPA = 20
const MIN_LOSS_PER_WEEK = '1.0'
const HORIZON_DAYS = 365
const WHEELS = ['fl', 'fr', 'rl', 'rr']

const wheel = (i: number, name: string): string => {
  const others = WHEELS.filter((w) => w !== name).map((w) => `tire_${w}_kpa`).join(' + ')
  return `SELECT reading_at, '${name}' AS wheel, ${i} AS ord, tire_${name}_kpa AS own, ` + `tire_${name}_kpa - (${others}) / 3.0 AS d FROM r`
}

export const FORECAST_SQL =
  'WITH r AS (SELECT reading_at, tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa FROM v_tire_readings ' +
  'WHERE time_known AND tire_fl_kpa IS NOT NULL AND tire_fr_kpa IS NOT NULL AND tire_rl_kpa IS NOT NULL ' +
  'AND tire_rr_kpa IS NOT NULL), ' +
  'newest AS (SELECT max(reading_at) AS t FROM r), ' +
  'w AS (' + WHEELS.map((n, i) => wheel(i, n)).join(' UNION ALL ') + '), ' +
  `recent AS (SELECT w.* FROM w CROSS JOIN newest n WHERE w.reading_at >= n.t - INTERVAL ${WINDOW_DAYS} DAY), ` +
  'j AS (SELECT *, d - lag(d) OVER (PARTITION BY wheel ORDER BY reading_at) AS jump, ' +
  'own - lag(own) OVER (PARTITION BY wheel ORDER BY reading_at) AS rise FROM recent), ' +
  `s AS (SELECT *, max(CASE WHEN rise >= ${REFILL_KPA} AND jump >= ${REFILL_AGAINST_KPA} THEN reading_at END) ` +
  'OVER (PARTITION BY wheel) ' +
  'AS restart FROM j), ' +
  'k AS (SELECT * FROM s WHERE restart IS NULL OR reading_at >= restart), ' +
  'stat AS (SELECT wheel, ord, count(*) AS n, ' +
  "date_diff('second', min(reading_at), max(reading_at)) / 86400.0 AS span_days, " +
  'arg_max(own, reading_at) AS current_kpa, max(reading_at) AS last_at, max(restart) AS refilled_at ' +
  'FROM k GROUP BY wheel, ord), ' +
  "slope AS (SELECT a.wheel, median((b.d - a.d) / (date_diff('second', a.reading_at, b.reading_at) / 86400.0)) " +
  'AS per_day FROM k a JOIN k b ON a.wheel = b.wheel AND b.reading_at >= a.reading_at + INTERVAL 1 DAY ' +
  'GROUP BY a.wheel), ' +
  'f AS (SELECT st.wheel, st.ord, st.n, st.span_days, st.current_kpa, st.last_at, st.refilled_at, ' +
  `st.n >= ${MIN_READINGS} AND st.span_days >= ${MIN_SPAN_DAYS} AND sl.per_day IS NOT NULL AS enough, ` +
  'sl.per_day * 7 AS per_week, CAST(? AS DOUBLE) AS limit_kpa ' +
  'FROM stat st LEFT JOIN slope sl ON sl.wheel = st.wheel), ' +
  `g AS (SELECT *, enough AND per_week <= -${MIN_LOSS_PER_WEEK} AS losing, ` +
  `CASE WHEN enough AND per_week <= -${MIN_LOSS_PER_WEEK} AND current_kpa > limit_kpa ` +
  'THEN (current_kpa - limit_kpa) / (-per_week / 7.0) END AS days_left FROM f) ' +
  'SELECT wheel, n AS measurements, round(span_days, 1) AS span_days, current_kpa, last_at, refilled_at, ' +
  'enough, CASE WHEN enough THEN round(per_week, 1) END AS kpa_per_week, coalesce(losing, false) AS losing, ' +
  'coalesce(losing AND current_kpa <= limit_kpa, false) AS below_limit, ' +
  `CASE WHEN days_left <= ${HORIZON_DAYS} THEN CAST(ceil(days_left) AS INTEGER) END AS days_left, ` +
  `CASE WHEN days_left <= ${HORIZON_DAYS} THEN strftime(last_at + to_days(CAST(ceil(days_left) AS INTEGER)), ` +
  "'%Y-%m-%d') END AS reaches_limit_on FROM g ORDER BY ord"

export const tireForecast: Handler = async ({ con }) => {
  const limit = (
    await con.one(
      "SELECT coalesce(try_cast(max(value) FILTER (WHERE key = 'tire_limit_kpa') AS DOUBLE), 200) AS v " + 'FROM ref_settings',
    )
  ).v as number
  const wheels = await con.rows(FORECAST_SQL, [limit])
  return {
    limit_kpa: limit,
    window_days: WINDOW_DAYS,
    min_measurements: MIN_READINGS,
    min_span_days: MIN_SPAN_DAYS,
    wheels: wheels.map((r) => pick(r, WHEEL_FORECAST)),
  }
}
