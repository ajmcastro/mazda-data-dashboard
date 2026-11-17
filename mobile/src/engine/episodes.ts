/**
 * Warning episodes and their patterns (port of `api/episodes.py`, PLAN.md M63), from the views
 * `v_warning_episodes` and `v_warning_pattern_codes`. The SQL is the Python route's: keep the two identical.
 * Patterns and each code's role are learned from all the data; the period only decides which episodes count.
 */
import type { Handler } from './context'
import { pick } from './http'
import { COMMON_CODE, PATTERN_CODE, PATTERN_FAULT } from './shapes'

const MIN_EPISODES = 3
const FAULT_HOURS = 24
const MAX_FAULTS = 5
const MIN_FAULT_EPISODES = 3
const FAULT_LIFT = 1.5
const COMPANION_SHARE = 0.8
const DEFAULT_GAP_MINUTES = 10

const GAP_SQL =
  "SELECT coalesce(try_cast(max(value) FILTER (WHERE key = 'warning_episode_minutes') AS INTEGER), " +
  `${DEFAULT_GAP_MINUTES}) AS gap FROM ref_settings`
const PATTERNS_SQL =
  'SELECT e.pattern, count(*) AS episodes, any_value(t.total) AS episodes_total, ' +
  'count(DISTINCT CAST(e.start_at AS DATE)) AS days, min(e.start_at) AS first_at, max(e.start_at) AS last_at, ' +
  "round(median(date_diff('second', e.start_at, e.end_at)) / 60.0, 1) AS median_minutes " +
  'FROM v_warning_episodes e ' +
  'JOIN (SELECT pattern, count(*) AS total FROM v_warning_episodes GROUP BY pattern) t USING (pattern) ' +
  '{where} GROUP BY e.pattern ORDER BY episodes DESC, e.pattern'
const CODES_SQL =
  'SELECT pc.pattern, pc.code, r.title, pc.role, pc.pct FROM v_warning_pattern_codes pc ' +
  "LEFT JOIN ref_warning_codes r ON r.code = pc.code WHERE pc.role <> 'common' " +
  "ORDER BY pc.pattern, CASE pc.role WHEN 'core' THEN 0 ELSE 1 END, pc.pct DESC, pc.code"
const COMMON_SQL =
  'SELECT pc.code, any_value(r.title) AS title, ' +
  'round(100.0 * sum(pc.episodes_with) / any_value(t.n), 1) AS pct ' +
  'FROM v_warning_pattern_codes pc CROSS JOIN (SELECT count(*) AS n FROM v_warning_episodes) t ' +
  "LEFT JOIN ref_warning_codes r ON r.code = pc.code WHERE pc.role = 'common' " +
  'GROUP BY pc.code ORDER BY pct DESC, pc.code'
const FAULTS_SQL =
  'WITH e AS (SELECT e.episode, e.pattern, e.start_at, e.end_at FROM v_warning_episodes e {where}), ' +
  'near AS (SELECT DISTINCT e.episode, e.pattern, d.ecu, d.dtc_code FROM e JOIN v_dtc_events d ' +
  `ON d.event_at >= e.start_at - INTERVAL ${FAULT_HOURS} HOUR ` +
  `AND d.event_at <= e.end_at + INTERVAL ${FAULT_HOURS} HOUR), ` +
  'sizes AS (SELECT pattern, count(*) AS n FROM e GROUP BY pattern), ' +
  'base AS (SELECT ecu, dtc_code, count(*) AS n FROM near GROUP BY ecu, dtc_code), ' +
  'titles AS (SELECT ecu, dtc_code, any_value(CASE WHEN known THEN title END) AS title ' +
  'FROM v_dtc_events GROUP BY ecu, dtc_code) ' +
  'SELECT nr.pattern, nr.ecu, nr.dtc_code, any_value(t.title) AS title, count(*) AS episodes, ' +
  'round(100.0 * count(*) / any_value(s.n), 1) AS pct, ' +
  'round(100.0 * any_value(b.n) / any_value(a.n), 1) AS pct_all ' +
  'FROM near nr JOIN sizes s USING (pattern) JOIN base b USING (ecu, dtc_code) ' +
  'CROSS JOIN (SELECT count(*) AS n FROM e) a LEFT JOIN titles t USING (ecu, dtc_code) ' +
  'GROUP BY nr.pattern, nr.ecu, nr.dtc_code ' +
  `HAVING count(*) >= ${MIN_FAULT_EPISODES} ` +
  `AND count(*) * any_value(a.n) >= ${FAULT_LIFT} * any_value(b.n) * any_value(s.n) ` +
  'ORDER BY nr.pattern, episodes DESC, nr.ecu, nr.dtc_code'
const COMPANIONS_SQL =
  'WITH ec AS (SELECT DISTINCT episode, code FROM ' +
  '(SELECT episode, unnest(codes) AS code FROM v_warning_episodes) u), ' +
  "common AS (SELECT DISTINCT code FROM v_warning_pattern_codes WHERE role = 'common'), " +
  'n AS (SELECT code, count(*) AS n FROM ec GROUP BY code) ' +
  'SELECT a.code, any_value(n.n) AS episodes, b.code AS other, count(*) AS together ' +
  'FROM ec a JOIN ec b ON a.episode = b.episode AND a.code <> b.code JOIN n ON n.code = a.code ' +
  'WHERE a.code NOT IN (SELECT code FROM common) AND b.code NOT IN (SELECT code FROM common) ' +
  'GROUP BY a.code, b.code ' +
  `HAVING any_value(n.n) >= ${MIN_EPISODES} AND count(*) >= ${COMPANION_SHARE} * any_value(n.n) ` +
  'ORDER BY a.code, together DESC, other'

type Row = Record<string, unknown>

export const warningEpisodes: Handler = async ({ con, range }) => {
  const { sql: where, params } = range().clause('e.start_at')
  const gap = (await con.one(GAP_SQL)).gap
  const patterns = await con.rows(PATTERNS_SQL.replace('{where}', where), params)
  const codes = new Map<number, Row[]>()
  for (const r of await con.rows(CODES_SQL)) {
    const key = Number(r.pattern)
    if (!codes.has(key)) codes.set(key, [])
    codes.get(key)!.push(pick(r, PATTERN_CODE))
  }
  const faults = new Map<number, Row[]>()
  for (const r of await con.rows(FAULTS_SQL.replace('{where}', where), params)) {
    const key = Number(r.pattern)
    if (!faults.has(key)) faults.set(key, [])
    const found = faults.get(key)!
    if (found.length < MAX_FAULTS) found.push(pick(r, PATTERN_FAULT))
  }
  const companions = new Map<string, { code: unknown; episodes: unknown; codes: unknown[] }>()
  for (const r of await con.rows(COMPANIONS_SQL)) {
    const code = r.code as string
    if (!companions.has(code)) companions.set(code, { code, episodes: r.episodes, codes: [] })
    companions.get(code)!.codes.push(r.other)
  }
  const listed = patterns.map((p) => {
    const key = Number(p.pattern)
    return {
      pattern: p.pattern,
      episodes: p.episodes,
      episodes_total: p.episodes_total,
      recurring: Number(p.episodes_total) >= MIN_EPISODES,
      days: p.days,
      first_at: p.first_at,
      last_at: p.last_at,
      median_minutes: p.median_minutes,
      codes: codes.get(key) ?? [],
      faults: faults.get(key) ?? [],
    }
  })
  return {
    gap_minutes: gap,
    min_episodes: MIN_EPISODES,
    fault_hours: FAULT_HOURS,
    episodes: listed.reduce((n, p) => n + Number(p.episodes), 0),
    recurring_patterns: listed.filter((p) => p.recurring).length,
    one_off_episodes: listed.filter((p) => !p.recurring).reduce((n, p) => n + Number(p.episodes), 0),
    common: (await con.rows(COMMON_SQL)).map((r) => pick(r, COMMON_CODE)),
    companions: [...companions.values()],
    patterns: listed,
  }
}
