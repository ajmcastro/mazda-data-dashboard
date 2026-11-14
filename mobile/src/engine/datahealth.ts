/**
 * How much the loaded data can be trusted (port of `api/health.py`, PLAN.md M46): what each export covers,
 * where the status reports fall silent and which signals the car flags as Invalid. The SQL is the Python
 * route's: keep the two identical. Of the remote-status source only the signals a view reads by name are
 * judged (the pack carries no other); GPS positions are not in a pack at all.
 */
import type { Handler } from './context'
import { pick } from './http'
import { usedSignals } from './pack'
import { DATA_GAP, DATA_KIND, INVALID_SIGNAL } from './shapes'

const GAP_HOURS = 48
const MAX_GAPS = 20
const TRIMMED_SOURCE = 'rts'
const GPS_SIGNALS = ['latitude', 'longitude']

const snapshots = (source: string) => `(SELECT DISTINCT created_at FROM signal_readings WHERE source = '${source}') t`
/** [kind as in Mazda's file names, where its records are, the time of a record] */
const DATA_KINDS: [string, string, string][] = [
  ['war', 'warning_events', 'triggered_at'],
  ['dtc-h', 'dtc_headers', 'triggered_at'],
  ['dtc-d', 'v_dtc_events', 'event_at'],
  ['dtc-ssr', 'dtc_snapshots', 'triggered_at'],
  ['rts', snapshots('rts'), 'created_at'],
  ['vis', snapshots('vis'), 'created_at'],
  ['alt', snapshots('alt'), 'created_at'],
  ['diag', 'diag_reports', 'taken_at'],
]

const day = (at: unknown): string | null => (typeof at === 'string' ? at.slice(0, 10) : null)
const DAY_MS = 86_400_000

export const dataHealth: Handler = async ({ con, range }) => {
  const rng = range()
  const kinds: Record<string, unknown>[] = []
  for (const [kind, source, ts] of DATA_KINDS) {
    const { sql, params } = rng.clause(ts, 'AND')
    const found = await con.one(
      `SELECT min(${ts}) AS first_at, max(${ts}) AS last_at, count(*) AS records, ` +
        `count(DISTINCT CAST(${ts} AS DATE)) AS days FROM ${source} WHERE ${ts} IS NOT NULL ${sql}`,
      params,
    )
    kinds.push(pick({ kind, ...found }, DATA_KIND))
  }
  const firsts = kinds.map((k) => day(k.first_at)).filter((d): d is string => d !== null).sort()
  const lasts = kinds.map((k) => day(k.last_at)).filter((d): d is string => d !== null).sort()
  // the days looked at: the chosen period, or the span of the data when none is chosen
  const rangeFrom = rng.start ?? firsts[0] ?? null
  const rangeTo = rng.end ?? lasts[lasts.length - 1] ?? null
  const days = rangeFrom && rangeTo ? Math.round((Date.parse(`${rangeTo}T00:00:00Z`) - Date.parse(`${rangeFrom}T00:00:00Z`)) / DAY_MS) + 1 : 0

  const { sql: where, params } = rng.clause('created_at')
  const status = await con.one(
    'SELECT count(*) AS snapshots, count(DISTINCT CAST(created_at AS DATE)) AS days_with_status ' +
      `FROM v_vehicle_status ${where}`,
    params,
  )
  const silences =
    'WITH s AS (SELECT created_at, lag(created_at) OVER (ORDER BY created_at) AS previous ' +
    `FROM v_vehicle_status ${where}), ` +
    'g AS (SELECT previous AS from_at, created_at AS to_at, ' +
    "date_diff('second', previous, created_at) AS seconds FROM s WHERE previous IS NOT NULL) "
  const threshold = GAP_HOURS * 3600
  const gapStats = await con.one(
    silences +
      'SELECT round(max(seconds) / 3600.0, 1) AS longest_gap_hours, ' +
      'round(median(seconds) / 3600.0, 1) AS median_gap_hours, ' +
      'count(*) FILTER (WHERE seconds >= ?) AS gaps_total FROM g',
    [...params, threshold],
  )
  const gaps = await con.rows(
    silences +
      'SELECT from_at, to_at, round(seconds / 3600.0, 1) AS hours FROM g WHERE seconds >= ? ' +
      'ORDER BY seconds DESC, from_at LIMIT ?',
    [...params, threshold, MAX_GAPS],
  )

  const judged = usedSignals()
  const marks = judged.map(() => '?').join(', ')
  const skip = GPS_SIGNALS.map(() => '?').join(', ')
  const inRange = rng.clause('created_at', 'AND')
  const which = `FROM signal_readings WHERE (source <> ? OR signal IN (${marks})) AND signal NOT IN (${skip}) ${inRange.sql}`
  const whichParams = [TRIMMED_SOURCE, ...judged, ...GPS_SIGNALS, ...inRange.params]
  const isInvalid = 'count(*) FILTER (WHERE valid IS FALSE)'
  const totals = await con.one(
    "SELECT count(DISTINCT source || '/' || signal) AS signals_checked, count(*) AS readings_checked, " +
      `${isInvalid} AS invalid_readings ${which}`,
    whichParams,
  )
  const invalid = await con.rows(
    `SELECT source, signal, count(*) AS readings, ${isInvalid} AS invalid, ` +
      `round(100.0 * ${isInvalid} / count(*), 1) AS pct ${which} ` +
      `GROUP BY source, signal HAVING ${isInvalid} > 0 ` +
      'ORDER BY pct DESC, invalid DESC, source, signal',
    whichParams,
  )
  return {
    has_data: kinds.some((k) => (k.records as number) > 0),
    range_from: rangeFrom,
    range_to: rangeTo,
    days_in_range: days,
    snapshots: status.snapshots,
    days_with_status: status.days_with_status,
    gap_threshold_hours: GAP_HOURS,
    gaps_total: gapStats.gaps_total,
    longest_gap_hours: gapStats.longest_gap_hours ?? null,
    median_gap_hours: gapStats.median_gap_hours ?? null,
    signals_checked: totals.signals_checked,
    readings_checked: totals.readings_checked,
    invalid_readings: totals.invalid_readings,
    kinds,
    gaps: gaps.map((r) => pick(r, DATA_GAP)),
    invalid: invalid.map((r) => pick(r, INVALID_SIGNAL)),
  }
}
