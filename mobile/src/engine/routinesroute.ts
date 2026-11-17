/**
 * Driving routines (port of `api/routines.py`, PLAN.md M66): the stretches grouped into the car's recurring kinds
 * of stretch, from all its data. Keep the two identical.
 */
import type { Handler } from './context'
import { pyRound } from './pyround'
import { cluster, features, hoursAround, median } from './routines'

const GAP_HOURS = 48
const MIN_STRETCHES = 8
const MIN_DAYS = 4
const MIN_SILHOUETTE = 0.25
const MIN_KM = 20
const ENOUGH = 30

const STRETCHES_SQL =
  "WITH cfg AS (SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone " +
  'FROM ref_settings), s AS (SELECT t.end_at, t.km, t.fuel_l, t.driving_seconds, ' +
  'timezone(c.zone, make_timestamptz(epoch_us(t.end_at))) AS local_end ' +
  `FROM v_trip_segments t CROSS JOIN cfg c WHERE t.gap_hours < ${GAP_HOURS} AND t.km > 0) ` +
  'SELECT end_at, km, fuel_l, driving_seconds, hour(local_end) + minute(local_end) / 60.0 AS hour, ' +
  "isodow(local_end) >= 6 AS weekend, strftime(local_end, '%Y-%m-%d') AS local_day " +
  'FROM s ORDER BY end_at'

interface Stretch {
  end_at: unknown
  km: number
  fuel_l: number | null
  driving_seconds: number | null
  hour: number
  weekend: boolean
  local_day: string
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function describe(group: Stretch[]) {
  let km = 0
  for (const r of group) km += r.km
  const priced = group.filter((r) => r.fuel_l !== null && r.fuel_l >= 0)
  let fuel = 0
  for (const r of priced) fuel += r.fuel_l!
  let fuelKm = 0
  for (const r of priced) fuelKm += r.km
  const minutes = group.filter((r) => r.driving_seconds && r.driving_seconds > 0).map((r) => r.driving_seconds! / 60)
  const [hour, low, high] = hoursAround(group.map((r) => r.hour))
  const minutesMedian = median(minutes)
  return {
    stretches: group.length,
    days: new Set(group.map((r) => r.local_day)).size,
    km: pyRound(km, 1),
    km_median: pyRound(median(group.map((r) => r.km))!, 1),
    minutes_median: minutes.length ? pyRound(minutesMedian!, 1) : null,
    weekend_pct: pyRound((100 * group.filter((r) => r.weekend).length) / group.length, 1),
    hour: pyRound(hour, 1),
    hour_low: pyRound(low, 1),
    hour_high: pyRound(high, 1),
    l_per_100km: fuelKm >= MIN_KM ? pyRound((100 * fuel) / fuelKm, 2) : null,
  }
}

export const drivingRoutines: Handler = async ({ con }) => {
  const found: Stretch[] = (await con.rows(STRETCHES_SQL)).map((r) => ({
    end_at: r.end_at,
    km: Number(r.km),
    fuel_l: num(r.fuel_l),
    driving_seconds: num(r.driving_seconds),
    hour: Number(r.hour),
    weekend: Boolean(r.weekend),
    local_day: String(r.local_day),
  }))
  const n = found.length
  let k = 1
  let sil = 0.0
  const labels: (number | null)[] = new Array(n).fill(null)
  if (n >= ENOUGH) {
    const points = features(found.map((r) => r.km), found.map((r) => r.hour), found.map((r) => r.weekend))
    const [kk, , groups, s] = cluster(points)
    k = kk
    sil = s
    const clear = sil >= MIN_SILHOUETTE
    const kept: number[][] = []
    for (let g = 0; g < k; g++) {
      const members = groups.flatMap((x, i) => (x === g ? [i] : []))
      if (clear && members.length >= MIN_STRETCHES && new Set(members.map((i) => found[i].local_day)).size >= MIN_DAYS) kept.push(members)
    }
    kept.sort((a, b) => b.length - a.length || a[0] - b[0])
    kept.forEach((members, idx) => {
      for (const i of members) labels[i] = idx + 1
    })
  }
  let totalKm = 0
  for (const r of found) totalKm += r.km
  const most = Math.max(0, ...labels.map((x) => x ?? 0))
  const routines = []
  for (let number = 1; number <= most; number++) {
    const d = describe(found.filter((_, i) => labels[i] === number))
    routines.push({ routine: number, ...d, km_share_pct: pyRound((100 * d.km) / totalKm, 1) })
  }
  const other = found.filter((_, i) => labels[i] === null)
  let otherKm = 0
  for (const r of other) otherKm += r.km
  return {
    enough: n >= ENOUGH,
    stretches: n,
    km: pyRound(totalKm, 1),
    k,
    silhouette: pyRound(sil, 3),
    clear: sil >= MIN_SILHOUETTE,
    min_stretches: MIN_STRETCHES,
    min_days: MIN_DAYS,
    min_silhouette: MIN_SILHOUETTE,
    routines: routines.map((r) => ({
      routine: r.routine, stretches: r.stretches, days: r.days, km: r.km, km_share_pct: r.km_share_pct, km_median: r.km_median,
      minutes_median: r.minutes_median, weekend_pct: r.weekend_pct, hour: r.hour, hour_low: r.hour_low, hour_high: r.hour_high,
      l_per_100km: r.l_per_100km,
    })),
    other_stretches: other.length,
    other_km: pyRound(otherKm, 1),
    members: found.map((r, i) => ({ end_at: r.end_at, routine: labels[i] })),
  }
}
