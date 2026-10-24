/** Month-by-month metrics (port of `api/trends.py`). Months without data stay in the series with empty metrics. */
import type { Handler } from './context'
import type { Con, Param } from './db'
import { Ts } from './db'
import { addDays, daysBetween, type DateRange } from './dates'
import { pick } from './http'
import { MONTH_METRICS } from './shapes'
import { pyRound } from './pyround'

const monthSql = (col: string) => `strftime(date_trunc('month', ${col}), '%Y-%m')`

async function byMonth(con: Con, sql: string, params: readonly Param[] = []): Promise<Map<string, Record<string, any>>> {
  return new Map((await con.rows(sql, params)).map((r) => [r.month as string, r]))
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate() // month is 1-based, day 0 of the next month
}

export async function monthlyMetrics(con: Con, rng: DateRange): Promise<Record<string, unknown>[]> {
  const span = await con.one(
    'SELECT CAST(min(read_at) AS DATE) AS a, CAST(max(read_at) AS DATE) AS b FROM v_odometer_readings',
  )
  if (!span.a) return []
  const a = span.a as string
  const b = span.b as string
  const lo = rng.start && rng.start > a ? rng.start : a
  const hi = rng.end && rng.end < b ? rng.end : b
  if (lo > hi) return []

  let w = rng.clause('read_at')
  const odo = await byMonth(
    con,
    `SELECT ${monthSql('read_at')} AS month, max(odometer_km) AS end_odo, min(odometer_km) AS min_odo FROM v_odometer_readings ${w.sql} GROUP BY 1`,
    w.params,
  )
  w = rng.clause('end_at')
  const drives = await byMonth(
    con,
    `SELECT ${monthSql('end_at')} AS month, sum(km) AS km, sum(fuel_l) AS fuel_l, sum(driving_seconds) AS secs, ` +
      `count(*) AS drives, count(DISTINCT CAST(end_at AS DATE)) AS days_driven FROM v_trip_segments ${w.sql} GROUP BY 1`,
    w.params,
  )
  w = rng.clause('triggered_at')
  const events = await byMonth(
    con,
    `SELECT ${monthSql('triggered_at')} AS month, count(*) AS n FROM warning_events ${w.sql} GROUP BY 1`,
    w.params,
  )
  const codes = await byMonth(
    con,
    `SELECT ${monthSql('triggered_at')} AS month, count(DISTINCT code) AS n FROM v_warnings ${w.sql} GROUP BY 1`,
    w.params,
  )
  w = rng.clause('event_at')
  const readouts = await byMonth(
    con,
    `SELECT ${monthSql('event_at')} AS month, count(*) FILTER (WHERE faults > 0) AS n FROM v_dtc_readout_summary ${w.sql} GROUP BY 1`,
    w.params,
  )
  const faults = await byMonth(
    con,
    `SELECT ${monthSql('event_at')} AS month, ` +
      "count(DISTINCT ecu || '|' || dtc_code || '|' || coalesce(failure_type, '')) AS n " +
      `FROM v_dtc_events ${w.sql} GROUP BY 1`,
    w.params,
  )
  // "New" = first reported after the first day of diagnostic data (whatever the car listed on that
  // first day may have been there long before the data begins).
  const fs = rng.clause('first_seen')
  const newFaults = await byMonth(
    con,
    `SELECT ${monthSql('first_seen')} AS month, count(*) AS n FROM (` +
      'SELECT min(event_at) AS first_seen FROM v_dtc_events GROUP BY ecu, dtc_code, failure_type ' +
      'HAVING CAST(min(event_at) AS DATE) > (SELECT CAST(min(coalesce(triggered_at, copied_at)) AS DATE) ' +
      `FROM dtc_headers)) ${fs.sql} GROUP BY 1`,
    fs.params,
  )
  w = rng.clause('created_at')
  const tires = await byMonth(
    con,
    `SELECT ${monthSql('created_at')} AS month, ` +
      '(avg(tire_fl_kpa) + avg(tire_fr_kpa) + avg(tire_rl_kpa) + avg(tire_rr_kpa)) / 4 AS avg_kpa, ' +
      'min(least(tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa)) AS min_kpa ' +
      `FROM v_vehicle_status ${w.sql} GROUP BY 1`,
    w.params,
  )

  const out: Record<string, unknown>[] = []
  const [y0, m0] = lo.split('-').map(Number)
  for (let y = y0, m = m0; `${y}-${String(m).padStart(2, '0')}-01` <= hi; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const key = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
    const first = `${key}-01`
    const dim = daysInMonth(y, m)
    const endOfMonth = addDays(first, dim - 1)
    const covered = daysBetween(lo > first ? lo : first, hi < endOfMonth ? hi : endOfMonth) + 1
    const row: Record<string, unknown> = { month: key, days_in_month: dim, days_covered: covered, partial: covered < dim }

    const o = odo.get(key)
    const d = drives.get(key)
    if (o) {
      // Highest odometer in the month minus the last reading before the month (or before the period
      // starts, if later); the month's own lowest reading if there is none.
      const effectiveStart = rng.start && rng.start > first ? rng.start : first
      let base = (await con.one('SELECT max(odometer_km) AS v FROM v_odometer_readings WHERE read_at < ?', [new Ts(`${effectiveStart} 00:00:00`)])).v as number | null
      row.distance_km = pyRound(o.end_odo - (base ?? o.min_odo), 1)
    }
    if (d) {
      row.drives = d.drives
      row.days_driven = d.days_driven
      const hours = d.secs ? d.secs / 3600 : null
      row.driving_hours = hours ? pyRound(hours, 1) : null
      row.avg_speed_kmh = hours && d.km ? pyRound(d.km / hours, 1) : null
      if (d.km) {
        row.l_per_100km = pyRound((100 * d.fuel_l) / d.km, 2)
        if (row.distance_km !== undefined && row.distance_km !== null) {
          row.fuel_l_est = pyRound(((row.distance_km as number) * (row.l_per_100km as number)) / 100, 1)
        }
      }
    }
    if (events.has(key)) {
      row.warning_events = events.get(key)!.n
      row.warning_codes = codes.get(key)?.n ?? 0
    }
    if (readouts.has(key)) {
      row.fault_readouts = readouts.get(key)!.n
      row.distinct_faults = faults.get(key)?.n ?? 0
      row.new_faults = newFaults.get(key)?.n ?? 0
    }
    const t = tires.get(key)
    if (t && t.avg_kpa !== null) {
      row.tire_avg_kpa = pyRound(t.avg_kpa, 1)
      row.tire_min_kpa = t.min_kpa
    }
    out.push(pick(row, MONTH_METRICS))
  }
  return out
}

export const trendsMonthly: Handler = async ({ con, range }) => monthlyMetrics(con, range())

