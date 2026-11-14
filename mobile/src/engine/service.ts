/**
 * The service log (port of the GET of `api/service.py`, PLAN.md M50): what the owner noted was done to the car
 * and what the data hints at that the log does not have. The SQL is the Python route's: keep the two identical.
 * A pack made before M50 has no `ref_service_log`: the log is then empty. The phone never writes the log.
 */
import type { Handler } from './context'
import { pick } from './http'
import { SERVICE_ENTRY, SERVICE_SUGGESTION } from './shapes'

const KINDS = ['oil_change', 'tires', 'service', 'software', 'repair', 'other']
const NEAR_DAYS = 7
const LOG = 'log AS (SELECT n, served_on, kind, note, odometer_km FROM ref_service_log), '
const NO_LOG =
  'log AS (SELECT CAST(NULL AS INTEGER) AS n, CAST(NULL AS DATE) AS served_on, CAST(NULL AS VARCHAR) AS kind, ' +
  'CAST(NULL AS VARCHAR) AS note, CAST(NULL AS DOUBLE) AS odometer_km WHERE false), '
const SUGGESTED =
  "cfg AS (SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone FROM ref_settings), " +
  "sug AS (SELECT 'oil_change' AS kind, 'oil_countdown' AS reason, " +
  'CAST(timezone(c.zone, make_timestamptz(epoch_us(o.read_at))) AS DATE) AS d, o.odometer_km ' +
  'FROM v_oil_readings o CROSS JOIN cfg c WHERE o.remaining_km > o.previous_km ' +
  "UNION ALL SELECT 'service', 'diagnostic_report', " +
  'CAST(timezone(c.zone, make_timestamptz(epoch_us(r.taken_at))) AS DATE) AS d, max(r.odometer_km) ' +
  'FROM diag_reports r CROSS JOIN cfg c WHERE r.taken_at IS NOT NULL GROUP BY d) ' +
  "SELECT s.kind, s.reason, strftime(s.d, '%Y-%m-%d') AS date, s.odometer_km FROM sug s " +
  "WHERE NOT EXISTS (SELECT 1 FROM log l WHERE abs(date_diff('day', l.served_on, s.d)) <= " +
  `${NEAR_DAYS} AND (s.kind = 'service' OR l.kind = s.kind)) ORDER BY s.d DESC, s.kind`

export const serviceLog: Handler = async ({ con }) => {
  const base = 'WITH ' + ((await con.hasTable('ref_service_log')) ? LOG : NO_LOG)
  const entries = await con.rows(
    base.slice(0, -2) + " SELECT strftime(served_on, '%Y-%m-%d') AS date, kind, note, odometer_km FROM log " + 'ORDER BY served_on DESC, n DESC',
  )
  const suggestions = await con.rows(base + SUGGESTED)
  return {
    kinds: KINDS,
    entries: entries.map((r) => pick(r, SERVICE_ENTRY)),
    suggestions: suggestions.map((r) => pick(r, SERVICE_SUGGESTION)),
  }
}
