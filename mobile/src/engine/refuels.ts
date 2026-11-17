/**
 * Fill-ups (port of `api/refuels.py`, PLAN.md M47): the rises of the fuel level between two status snapshots
 * (`v_refuels`) with what the owner noted paying (`ref_fuel_paid`). The SQL is the Python route's: keep the two
 * identical. A pack made before M47 has no `ref_fuel_paid`: the fill-ups are then listed without payments.
 */
import type { Handler } from './context'
import { pick } from './http'
import { FUEL_PAYMENT, REFUEL } from './shapes'

const MAX_DAYS_OFF = 3
const LITRES_LOW = 0.6
const LITRES_HIGH = 1.15

// every payment with the fill-up it belongs to (NULL: no fill-up within MAX_DAYS_OFF days), scored (M70)
const MATCHED =
  'WITH pay AS (SELECT row_number() OVER (ORDER BY paid_on, paid, litres) AS n, paid_on, paid, litres ' +
  'FROM ref_fuel_paid), ' +
  'cand AS (SELECT p.n, r.after_at, CASE WHEN p.paid_on BETWEEN r.local_day_before AND r.local_day_after THEN 0 ' +
  "ELSE least(abs(date_diff('day', p.paid_on, r.local_day_before)), " +
  "abs(date_diff('day', p.paid_on, r.local_day_after))) END AS days_off, " +
  'CASE WHEN p.litres IS NULL OR r.litres IS NULL OR p.litres <= 0 THEN NULL ' +
  `ELSE r.litres / p.litres BETWEEN ${LITRES_LOW} AND ${LITRES_HIGH} END AS litres_ok ` +
  'FROM pay p CROSS JOIN v_refuels r), ' +
  'ranked AS (SELECT *, row_number() OVER (PARTITION BY n ORDER BY days_off * 10 + ' +
  'CASE WHEN litres_ok = false THEN 5 ELSE 0 END, after_at) AS k ' +
  `FROM cand WHERE days_off <= ${MAX_DAYS_OFF}), ` +
  'matched AS (SELECT p.n, p.paid_on, p.paid, p.litres, b.after_at, b.days_off, b.litres_ok, ' +
  'CASE WHEN b.after_at IS NULL THEN NULL ' +
  "WHEN b.days_off = 0 AND coalesce(b.litres_ok, true) THEN 'high' " +
  "WHEN b.days_off = 0 OR (b.days_off = 1 AND coalesce(b.litres_ok, true)) THEN 'medium' " +
  "ELSE 'low' END AS confidence FROM pay p LEFT JOIN ranked b ON b.n = p.n AND b.k = 1) "
const NO_PAYMENTS =
  'WITH matched AS (SELECT CAST(NULL AS BIGINT) AS n, CAST(NULL AS DATE) AS paid_on, ' +
  'CAST(NULL AS DOUBLE) AS paid, CAST(NULL AS DOUBLE) AS litres, CAST(NULL AS TIMESTAMP) AS after_at, ' +
  'CAST(NULL AS BIGINT) AS days_off, CAST(NULL AS BOOLEAN) AS litres_ok, CAST(NULL AS VARCHAR) AS confidence ' +
  'WHERE false) '
const fillUps = (where: string) =>
  ', per AS (SELECT after_at, round(sum(paid), 2) AS paid, round(sum(litres), 1) AS paid_litres, ' +
  'count(*) AS payments, max(days_off) AS days_off, bool_or(litres_ok = false) AS litres_differ, ' +
  "CASE WHEN bool_or(confidence = 'low') THEN 'low' WHEN bool_or(confidence = 'medium') THEN 'medium' " +
  "ELSE 'high' END AS confidence FROM matched WHERE after_at IS NOT NULL GROUP BY after_at), " +
  'f AS (SELECT r.before_at, r.after_at, r.level_before, r.level_after, r.points, r.gap_hours, ' +
  'r.odometer_km, r.doubtful, r.litres, r.km_since_previous, r.used_since_previous_l, ' +
  'r.l_per_100km_since_previous, r.est_cost, per.paid, per.paid_litres, ' +
  'coalesce(per.payments, 0) AS payments, per.days_off, coalesce(per.litres_differ, false) AS litres_differ, ' +
  `per.confidence FROM v_refuels r LEFT JOIN per ON per.after_at = r.after_at ${where}) `

export const refuels: Handler = async ({ con, range }) => {
  const rng = range()
  const { sql: where, params } = rng.clause('r.after_at')
  const base = ((await con.hasTable('ref_fuel_paid')) ? MATCHED : NO_PAYMENTS) + fillUps(where)
  const settings = await con.one(
    "SELECT try_cast(max(value) FILTER (WHERE key = 'tank_litres') AS DOUBLE) AS tank_litres, " +
      "coalesce(try_cast(max(value) FILTER (WHERE key = 'refuel_min_points') AS DOUBLE), 15) AS min_points, " +
      "max(value) FILTER (WHERE key = 'fuel_currency') AS currency FROM ref_settings",
  )
  const totals = await con.one(
    base +
      'SELECT count(*) AS fill_ups, count(*) FILTER (WHERE doubtful) AS doubtful, ' +
      'round(sum(litres), 1) AS litres, round(sum(est_cost), 2) AS est_cost, round(sum(paid), 2) AS paid, ' +
      'count(*) FILTER (WHERE payments > 0) AS paid_fill_ups FROM f',
    params,
  )
  const listed = await con.rows(base + 'SELECT * FROM f ORDER BY after_at DESC', params)
  // a payment on a day of the period that no fill-up was seen around
  const conds: string[] = []
  const dayParams: string[] = []
  if (rng.start) {
    conds.push('paid_on >= CAST(? AS DATE)')
    dayParams.push(rng.start)
  }
  if (rng.end) {
    conds.push('paid_on <= CAST(? AS DATE)')
    dayParams.push(rng.end)
  }
  const unmatched = await con.rows(
    base + 'SELECT paid_on, paid, litres FROM matched WHERE after_at IS NULL ' + conds.map((c) => `AND ${c} `).join('') + 'ORDER BY paid_on, n',
    [...params, ...dayParams],
  )
  return {
    tank_litres: settings.tank_litres ?? null,
    min_points: settings.min_points,
    currency: settings.currency ?? null,
    fill_ups: totals.fill_ups,
    doubtful: totals.doubtful,
    litres: totals.litres ?? null,
    est_cost: totals.est_cost ?? null,
    paid: totals.paid ?? null,
    paid_fill_ups: totals.paid_fill_ups,
    refuels: listed.map((r) => pick(r, REFUEL)),
    unmatched: unmatched.map((r) => pick(r, FUEL_PAYMENT)),
  }
}
