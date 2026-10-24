/** The car's warning-lamp bit flags (port of `warning_flags` / `warning_flag_hints` in `api/app.py`). A state. */
import type { Handler } from './context'
import { HttpError, pick } from './http'
import { HINT_FAULT, HINT_WARNING, WARNING_FLAG, WARNING_FLAG_EPISODE } from './shapes'

const COLS =
  'flag, area, bit, title, severity, notes, readings, readings_on, pct_on, first_on_at, last_on_at, ' +
  'on_now, max_value, first_on_report_day, episodes'

export const warningFlags: Handler = async ({ con }) => {
  const flags = await con.rows(
    `SELECT ${COLS} FROM v_warning_flags ORDER BY CASE area WHEN 'powertrain' THEN 0 ELSE 1 END, bit, flag`,
  )
  const episodes = await con.rows(
    'SELECT flag, started_at, last_on_at, readings, max_value, ongoing FROM v_warning_flag_episodes ORDER BY flag, started_at',
  )
  const span = await con.one(
    'SELECT min(read_at) AS a, max(read_at) AS b FROM v_warning_flag_readings',
  )
  return {
    has_data: flags.length > 0,
    first_read_at: span.a ?? null,
    last_read_at: span.b ?? null,
    flags: flags.map((f) => pick(f, WARNING_FLAG)),
    episodes: episodes.map((e) => pick(e, WARNING_FLAG_EPISODE)),
  }
}

// What co-occurs with a flag: in how many readings with the flag on (and off) a warning code / fault is
// within the window, ranked by how much more often it is there when the flag is on.
const hintSql = (source: string, time: string, margin: number, keySelect: string, keyCols: string, order: string) =>
  `WITH f AS (SELECT read_at, is_on FROM v_warning_flag_readings WHERE flag = ?),
    n AS (SELECT count(*) FILTER (WHERE is_on) AS on_n, count(*) FILTER (WHERE NOT is_on) AS off_n FROM f),
    near AS (
        SELECT DISTINCT f.read_at, f.is_on, ${keySelect}
        FROM f JOIN ${source} s ON s.${time} BETWEEN f.read_at - to_microseconds(${margin})
                                              AND f.read_at + to_microseconds(${margin})),
    c AS (
        SELECT ${keyCols}, count(*) FILTER (WHERE is_on) AS on_with, count(*) FILTER (WHERE NOT is_on) AS off_with
        FROM near GROUP BY ${keyCols}),
    r AS (
        SELECT c.*, round(on_with * 1.0 / nullif(n.on_n, 0), 3) AS share_on,
               round(off_with * 1.0 / nullif(n.off_n, 0), 3) AS share_off
        FROM c CROSS JOIN n)
    SELECT * FROM r WHERE on_with > 0 AND coalesce(share_on, 0) - coalesce(share_off, 0) > 0
    ORDER BY coalesce(share_on, 0) - coalesce(share_off, 0) DESC, on_with DESC, ${order} LIMIT 8`

export const warningFlagHints: Handler = async ({ con, q }) => {
  const flag = q.required('flag')
  const windowHours = q.float('window_hours', 2, 0, 48)
  if (!Object.keys(await con.one('SELECT flag FROM v_warning_flags WHERE flag = ?', [flag])).length) {
    throw new HttpError(404, `No warning flag ${flag} that changes`)
  }
  const margin = Math.round(windowHours * 3_600_000_000)
  const counts = await con.one(
    'SELECT count(*) FILTER (WHERE is_on) AS on_n, count(*) FILTER (WHERE NOT is_on) AS off_n FROM v_warning_flag_readings WHERE flag = ?',
    [flag],
  )
  const warnings = await con.rows(
    hintSql('v_warnings', 'triggered_at', margin, 's.code, s.title, s.severity, s.known', 'code, title, severity, known', 'code'),
    [flag],
  )
  const faults = await con.rows(
    hintSql(
      'v_dtc_events',
      'event_at',
      margin,
      's.ecu, s.dtc_code, s.failure_type, s.title, s.severity',
      'ecu, dtc_code, failure_type, title, severity',
      'ecu, dtc_code',
    ),
    [flag],
  )
  return {
    flag,
    window_hours: windowHours,
    on_readings: counts.on_n,
    off_readings: counts.off_n,
    warnings: warnings.map((w) => pick(w, HINT_WARNING)),
    faults: faults.map((f) => pick(f, HINT_FAULT)),
  }
}
