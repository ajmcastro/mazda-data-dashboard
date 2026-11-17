/**
 * Unusual status reports (port of `api/unusual.py`, PLAN.md M64), from the view `v_unusual_reasons`. The SQL
 * is the Python route's: keep the two identical. What is usual comes from all the data; the period only
 * decides which reports are listed. Never a fault.
 */
import type { Handler } from './context'

const MIN_REPORTS = 30
const THRESHOLD_Z = 3.5
const RARE_PCT = 1.0

const CFG = "(SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone FROM ref_settings)"
const REASONS_SQL =
  'SELECT r.created_at AS at, r.kind, ' +
  "strftime(timezone(c.zone, make_timestamptz(epoch_us(r.created_at))), '%Y-%m-%d %H:%M') AS local, " +
  'r.feature, r.value, r.label, r.share_pct, r.z, r.usual_low, r.usual_high ' +
  `FROM v_unusual_reasons r CROSS JOIN ${CFG} c ` +
  '{where} ORDER BY r.created_at DESC, r.kind, r.feature'
const COUNTS_SQL =
  'SELECT (SELECT count(*) FROM v_vehicle_status {status}) AS status_reports, ' +
  '(SELECT count(*) FROM v_door_status {doors}) AS doors_reports, ' +
  '(SELECT count(*) FROM v_vehicle_status) AS status_all, ' +
  '(SELECT count(*) FROM v_door_status) AS doors_all'
const REASON_FIELDS = ['feature', 'value', 'label', 'share_pct', 'z', 'usual_low', 'usual_high'] as const

type Row = Record<string, unknown>

export const unusualReports: Handler = async ({ con, range }) => {
  const { sql: where, params } = range().clause('r.created_at')
  const found: { at: unknown; kind: unknown; local: unknown; reasons: Row[] }[] = []
  for (const r of await con.rows(REASONS_SQL.replace('{where}', where), params)) {
    const last = found[found.length - 1]
    if (!last || last.at !== r.at || last.kind !== r.kind) found.push({ at: r.at, kind: r.kind, local: r.local, reasons: [] })
    found[found.length - 1].reasons.push(Object.fromEntries(REASON_FIELDS.map((k) => [k, r[k] ?? null])))
  }
  const { sql: status, params: statusParams } = range().clause('created_at')
  const counts = await con.one(COUNTS_SQL.replace('{status}', status).replace('{doors}', status), [...statusParams, ...statusParams])
  return {
    min_reports: MIN_REPORTS,
    threshold_z: THRESHOLD_Z,
    rare_pct: RARE_PCT,
    status_reports: counts.status_reports,
    doors_reports: counts.doors_reports,
    enough_status: Number(counts.status_all) >= MIN_REPORTS,
    enough_doors: Number(counts.doors_all) >= MIN_REPORTS,
    reports: found,
  }
}
