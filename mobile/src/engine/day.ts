/**
 * One day at a glance (port of `api/day.py`, PLAN.md M49): everything the exports say about one day of the
 * car's LOCAL calendar, in time order. The SQL is the Python route's: keep the two identical. A pack without
 * an `alerts` table simply has no alert entries.
 */
import type { Handler } from './context'
import { parseDay } from './dates'
import { pick } from './http'
import { DAY_ENTRY } from './shapes'

const COLS =
  'kind, at_utc AS "at", until_utc AS "until", code, title, severity, n, km, l_per_100km, odometer_km, ' +
  'fuel_level_pct, d_fuel_pct, tire_min_kpa, litres, doubtful, text, ref, engine_state, alarm_status, ' +
  'alarm_reason'
// every column of an entry, typed, so each kind names only what it has
const NULLS: [string, string][] = [
  ['until_utc', 'TIMESTAMP'], ['code', 'VARCHAR'], ['title', 'VARCHAR'], ['severity', 'VARCHAR'], ['n', 'BIGINT'],
  ['km', 'DOUBLE'], ['l_per_100km', 'DOUBLE'], ['odometer_km', 'DOUBLE'], ['fuel_level_pct', 'DOUBLE'],
  ['d_fuel_pct', 'DOUBLE'], ['tire_min_kpa', 'DOUBLE'], ['litres', 'DOUBLE'], ['doubtful', 'BOOLEAN'],
  ['text', 'VARCHAR'], ['ref', 'VARCHAR'],
  // raw values that the documented meanings (M72) put into words on the page
  ['engine_state', 'DOUBLE'], ['alarm_status', 'DOUBLE'], ['alarm_reason', 'DOUBLE'],
]

/** One kind of entry: the columns it has, NULL for the rest. */
function select(
  kind: string, order: number, dayAt: string, at: string, source: string, cols: Record<string, string> = {}, fixedDay = 'CAST(NULL AS DATE)',
): string {
  const fields = NULLS.map(([name, type]) => `${cols[name] ?? `CAST(NULL AS ${type})`} AS ${name}`).join(', ')
  return `SELECT '${kind}' AS kind, ${order} AS ord, ${dayAt} AS day_at, ${fixedDay} AS fixed_day, ${at} AS at_utc, ${fields} FROM ${source}`
}

const OPEN =
  "concat_ws(', ', CASE WHEN door_driver <> 0 THEN 'driver door' END, " +
  "CASE WHEN door_passenger <> 0 THEN 'passenger door' END, " +
  "CASE WHEN door_rear_left <> 0 THEN 'rear left door' END, " +
  "CASE WHEN door_rear_right <> 0 THEN 'rear right door' END, " +
  "CASE WHEN trunk <> 0 THEN 'trunk' END, CASE WHEN hood <> 0 THEN 'hood' END)"

const SOURCES = [
  // a stretch of driving, seen by the later of its two reports
  select('drive', 1, 'end_at', 'start_at', 'v_trip_segments', { until_utc: 'end_at', km: 'round(km, 1)', l_per_100km: 'round(l_per_100km, 1)' }),
  // a warning code, once per day: how often, first and last
  select(
    'warning', 4, 'triggered_at', 'triggered_at',
    '(SELECT code, max(title) AS title, max(severity) AS severity, count(*) AS n, ' +
      'min(triggered_at) AS triggered_at, max(triggered_at) AS last_at, ' +
      'CAST(timezone(c.zone, make_timestamptz(epoch_us(triggered_at))) AS DATE) AS d ' +
      'FROM v_warnings CROSS JOIN cfg c WHERE triggered_at IS NOT NULL GROUP BY code, d) w',
    { until_utc: 'last_at', code: 'code', title: 'title', severity: 'severity', n: 'n' },
  ),
  // a fault read-out with the codes it listed
  select(
    'readout', 5, 'event_at', 'event_at',
    '(SELECT s.transaction_id, s.event_at, s.faults, s.odometer_km, ' +
      "(SELECT string_agg(e.dtc_code, ', ' ORDER BY e.dtc_code, e.ecu) FROM v_dtc_events e " +
      'WHERE e.transaction_id = s.transaction_id) AS codes FROM v_dtc_readout_summary s ' +
      'WHERE s.event_at IS NOT NULL) r',
    { n: 'faults', odometer_km: 'odometer_km', text: 'codes', ref: 'transaction_id' },
  ),
  // a status report, with the fuel level against the report before
  select(
    'status', 2, 'created_at', 'created_at',
    '(SELECT created_at, odometer_km, fuel_level_pct, ' +
      'fuel_level_pct - lag(fuel_level_pct) OVER (ORDER BY created_at) AS d_fuel, ' +
      'odometer_km - lag(odometer_km) OVER (ORDER BY created_at) AS d_km, ' +
      'least(tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa) AS tire_min, engine_state ' +
      'FROM v_vehicle_status) s',
    {
      km: 'round(d_km, 1)', odometer_km: 'odometer_km', fuel_level_pct: 'fuel_level_pct', d_fuel_pct: 'round(d_fuel, 1)', tire_min_kpa: 'tire_min',
      engine_state: 'engine_state',
    },
  ),
  // doors, trunk and hood: only when what is open differs from the report before
  select(
    'doors', 3, 'created_at', 'created_at',
    `(SELECT created_at, ${OPEN} AS open, lag(${OPEN}) OVER (ORDER BY created_at) AS before ` +
      "FROM v_door_status) d WHERE open IS DISTINCT FROM before AND (open <> '' OR before <> '')",
    { text: 'open' },
  ),
  select('alarm', 6, 'created_at', 'created_at', 'v_alarm_events', {
    text:
      "'status ' || CAST(CAST(burglar_status AS BIGINT) AS VARCHAR) || ', reason ' || " +
      'CAST(CAST(alarm_reason AS BIGINT) AS VARCHAR)',
    alarm_status: 'burglar_status',
    alarm_reason: 'alarm_reason',
  }),
  // a fill-up, seen by the later of its two reports
  select('fill_up', 7, 'after_at', 'before_at', 'v_refuels', {
    until_utc: 'after_at', litres: 'round(litres, 1)', fuel_level_pct: 'level_after', d_fuel_pct: 'round(points, 1)', doubtful: 'doubtful',
  }),
  select('diag', 8, 'taken_at', 'taken_at', 'diag_reports WHERE taken_at IS NOT NULL', { odometer_km: 'odometer_km', ref: 'report_id' }),
]
const ALERTS = select('alert', 9, 'occurred_at', 'occurred_at', 'alerts WHERE occurred_at IS NOT NULL', {
  code: 'rule', title: 'title', severity: 'severity', text: 'detail', ref: 'dedup_key',
})

// an entry of the service log: a day, not a moment, so it comes first on its day
const SERVICE = select(
  'service', 0, 'CAST(served_on AS TIMESTAMP)', 'CAST(NULL AS TIMESTAMP)', 'ref_service_log',
  { code: 'kind', text: 'note', odometer_km: 'odometer_km', n: 'n' }, 'served_on',
)

/** The CTEs every query starts with: `ev` = every entry of all time with its local day. */
const baseSql = (withAlerts: boolean, withService: boolean): string =>
  "WITH cfg AS (SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone " +
  'FROM ref_settings), src AS (' +
  [...SOURCES, ...(withAlerts ? [ALERTS] : []), ...(withService ? [SERVICE] : [])].join(' UNION ALL ') +
  '), ' +
  'ev AS (SELECT s.*, coalesce(s.fixed_day, CAST(timezone(c.zone, make_timestamptz(epoch_us(s.day_at))) ' +
  'AS DATE)) AS local_day, ' +
  'timezone(c.zone, make_timestamptz(epoch_us(s.at_utc))) AS local_at, ' +
  'timezone(c.zone, make_timestamptz(epoch_us(s.until_utc))) AS local_until FROM src s CROSS JOIN cfg c) '

export const day: Handler = async ({ con, q }) => {
  const asked = q.str('date')
  const on = asked === undefined ? undefined : parseDay('date', asked)
  const base = baseSql(await con.hasTable('alerts'), await con.hasTable('ref_service_log'))
  const zone = (
    await con.one("SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone FROM ref_settings")
  ).zone as string
  const span = await con.one(
    base +
      "SELECT strftime(min(local_day), '%Y-%m-%d') AS first_day, " +
      "strftime(max(local_day), '%Y-%m-%d') AS last_day FROM ev",
  )
  const chosen = on ?? (span.last_day as string | null | undefined) ?? null
  const none = { first_day: null, last_day: null, previous: null, next: null }
  if (chosen === null) return { date: null, time_zone: zone, ...none, entries: [] }
  const around = await con.one(
    base +
      'SELECT strftime(max(local_day) FILTER (WHERE local_day < ' +
      "CAST(? AS DATE)), '%Y-%m-%d') AS previous, strftime(min(local_day) FILTER " +
      "(WHERE local_day > CAST(? AS DATE)), '%Y-%m-%d') AS next FROM ev",
    [chosen, chosen],
  )
  const entries = await con.rows(
    base +
      `SELECT ${COLS}, strftime(local_at, '%Y-%m-%d %H:%M') AS local, ` +
      "strftime(local_until, '%Y-%m-%d %H:%M') AS local_until FROM ev " +
      'WHERE local_day = CAST(? AS DATE) ' +
      'ORDER BY day_at, ord, at_utc, code, ref, n, text',
    [chosen],
  )
  return {
    date: chosen,
    time_zone: zone,
    first_day: span.first_day ?? null,
    last_day: span.last_day ?? null,
    previous: around.previous ?? null,
    next: around.next ?? null,
    entries: entries.map((r) => pick(r, DAY_ENTRY)),
  }
}
