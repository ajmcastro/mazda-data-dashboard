/**
 * Consumption change points (port of `api/changes.py`, PLAN.md M65): the stretches' l/100 km weighted by km,
 * cut into segments by `changepoints.ts`, each with its share of short stretches. Keep the two identical.
 */
import type { Handler } from './context'
import { segment } from './changepoints'
import { pyRound } from './pyround'

const GAP_HOURS = 48
const MIN_STRETCH_KM = 5
const MIN_KM = 150
const MIN_STRETCHES = 10
const MIN_STEP = 0.3

const SERIES_SQL =
  'SELECT start_at, end_at, km, fuel_l FROM v_trip_segments ' +
  `WHERE km >= ${MIN_STRETCH_KM} AND gap_hours < ${GAP_HOURS} AND fuel_l IS NOT NULL ` +
  'ORDER BY end_at, start_at'
const ALL_SQL = `SELECT end_at, km FROM v_trip_segments WHERE gap_hours < ${GAP_HOURS} ORDER BY end_at, start_at`

const ms = (v: unknown) => Date.parse(String(v))

export const changePoints: Handler = async ({ con }) => {
  const series = await con.rows(SERIES_SQL)
  const values = series.map((r) => (100 * Number(r.fuel_l)) / Number(r.km))
  const weights = series.map((r) => Number(r.km))
  const segments = segment(values, weights, MIN_KM, MIN_STRETCHES, MIN_STEP)
  const every = await con.rows(ALL_SQL)
  const out = segments.map((s, i) => {
    const first = series[s.start]
    const last = series[s.end - 1]
    const after = i > 0 ? ms(series[segments[i - 1].end - 1].end_at) : null
    const until = i < segments.length - 1 ? ms(last.end_at) : null
    const mine = every.filter((r) => (after === null || ms(r.end_at) > after) && (until === null || ms(r.end_at) <= until))
    const short = mine.filter((r) => Number(r.km) < MIN_STRETCH_KM).length
    return {
      from_at: first.start_at,
      to_at: last.end_at,
      stretches: s.count,
      km: pyRound(s.weight, 1),
      l_per_100km: pyRound(s.mean, 2),
      short_pct: mine.length ? pyRound((100 * short) / mine.length, 1) : null,
    }
  })
  const km = weights.reduce((a, b) => a + b, 0)
  return {
    min_km: MIN_KM,
    min_stretches: MIN_STRETCHES,
    min_step: MIN_STEP,
    stretch_km: MIN_STRETCH_KM,
    stretches: series.length,
    km: pyRound(km, 1),
    enough: series.length >= 2 * MIN_STRETCHES && km >= 2 * MIN_KM,
    segments: out,
  }
}
