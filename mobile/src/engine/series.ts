/** Overview and the time-series endpoints (port of the first half of `api/app.py`). */
import type { Handler } from './context'
import {
  ALARM_EVENT, DOOR_POINT, FUEL_MONTH, LATEST_STATUS, ODOMETER_DAY, STATUS_POINT, TIRE_READING, TRIP_SEGMENT,
} from './shapes'
import { pick } from './http'

export const span: Handler = async ({ con }) => {
  const s = await con.one(
    'SELECT CAST(min(read_at) AS DATE) AS first_day, CAST(max(read_at) AS DATE) AS last_day FROM v_odometer_readings',
  )
  return pick(s, ['first_day', 'last_day'])
}

export const overview: Handler = async ({ con, range }) => {
  const rng = range()
  const odoW = rng.clause('read_at')
  const odo = await con.one(
    `SELECT read_at, odometer_km FROM v_odometer_readings ${odoW.sql} ORDER BY odometer_km DESC, read_at DESC LIMIT 1`,
    odoW.params,
  )
  const span = await con.one('SELECT min(read_at) AS a, max(read_at) AS b FROM v_odometer_readings')

  // Distance driven in the range: odometer at its end minus the last reading before its start
  // (or the first reading inside it when the range starts before any data).
  let km: number | null = null
  if (Object.keys(odo).length) {
    let base: number | null = null
    if (rng.startTs) {
      base = (await con.one('SELECT max(odometer_km) AS v FROM v_odometer_readings WHERE read_at < ?', [rng.startTs])).v as number | null
    }
    if (base === null) {
      base = (await con.one(`SELECT min(odometer_km) AS v FROM v_odometer_readings ${odoW.sql}`, odoW.params)).v as number
    }
    km = (odo.odometer_km as number) - base
  }

  const st = rng.clause('s.created_at', 'AND')
  const status = await con.one(
    'SELECT s.created_at AS at, s.fuel_level_pct, s.range_km, s.tire_fl_kpa, s.tire_fr_kpa, ' +
      's.tire_rl_kpa, s.tire_rr_kpa, t.measured_at AS tire_measured_at, ' +
      't.age_minutes AS tire_age_minutes, t.stale AS tire_stale ' +
      'FROM v_vehicle_status s LEFT JOIN v_tire_snapshots t ON t.created_at = s.created_at ' +
      `WHERE s.fuel_level_pct IS NOT NULL ${st.sql} ORDER BY s.created_at DESC LIMIT 1`,
    st.params,
  )
  const diag = await con.one('SELECT lifetime_l_per_100km FROM v_diag_summary ORDER BY taken_at DESC, report_id LIMIT 1')
  const seg = rng.clause('end_at')
  const economy = await con.one(
    `SELECT 100 * sum(fuel_l) / nullif(sum(km), 0) AS v FROM v_trip_segments ${seg.sql}`,
    seg.params,
  )
  const w = rng.clause('triggered_at')
  const warnings = await con.one(
    `SELECT (SELECT count(*) FROM warning_events) AS total, (SELECT count(*) FROM warning_events ${w.sql}) AS in_range`,
    w.params,
  )
  const ev = rng.clause('event_at')
  const faultsSeen = (
    await con.one(
      `SELECT count(*) AS n FROM (SELECT DISTINCT ecu, dtc_code, failure_type FROM v_dtc_events ${ev.sql})`,
      ev.params,
    )
  ).n
  const active = (await con.one('SELECT count(*) FILTER (WHERE active_in_latest_readout) AS n FROM v_dtc_frequency')).n
  const al = rng.clause('created_at', 'AND')
  const alarm = await con.one(
    'SELECT created_at, burglar_status, alarm_reason FROM v_alarm_events ' +
      `WHERE (burglar_status > 1 OR alarm_reason > 0) ${al.sql} ORDER BY created_at DESC LIMIT 1`,
    al.params,
  )
  const firstDay = span.a ? String(span.a).slice(0, 10) : null
  const lastDay = span.b ? String(span.b).slice(0, 10) : null
  return {
    vin: (await con.one('SELECT vin FROM warning_events LIMIT 1')).vin ?? null,
    odometer_km: odo.odometer_km ?? null,
    odometer_at: odo.read_at ?? null,
    data_from: span.a ?? null,
    data_to: span.b ?? null,
    range_from: rng.start ?? firstDay,
    range_to: rng.end ?? lastDay,
    has_data_in_range: Object.keys(odo).length > 0,
    km_in_range: km,
    lifetime_l_per_100km: diag.lifetime_l_per_100km ?? null,
    l_per_100km_in_range: economy.v ?? null,
    status: pick(status, LATEST_STATUS),
    warnings_total: warnings.total,
    warnings_in_range: warnings.in_range,
    active_faults: active || 0,
    faults_seen: faultsSeen,
    unmapped_codes: (await con.one('SELECT count(*) AS n FROM v_unmapped_codes')).n,
    alerts_new: (await con.hasTable('alerts'))
      ? (await con.one("SELECT count(*) AS n FROM alerts WHERE status = 'new'")).n
      : 0,
    last_alarm: Object.keys(alarm).length ? pick(alarm, ALARM_EVENT) : null,
  }
}

const shaped = (rows: Record<string, unknown>[], fields: readonly string[]) => rows.map((r) => pick(r, fields))

export const odometerDaily: Handler = async ({ con, range }) => {
  const { sql, params } = range().clause('day')
  return shaped(await con.rows(`SELECT * FROM v_odometer_daily ${sql} ORDER BY day`, params), ODOMETER_DAY)
}

export const fuelMonthly: Handler = async ({ con, range }) => {
  // same aggregates as the v_fuel_monthly view, over the segments inside the range
  const { sql, params } = range().clause('end_at')
  return shaped(
    await con.rows(
      "SELECT strftime(date_trunc('month', end_at), '%Y-%m') AS month, count(*) AS segments, " +
        'round(sum(km), 1) AS km, round(sum(fuel_l), 1) AS fuel_l, ' +
        'round(100 * sum(fuel_l) / nullif(sum(km), 0), 2) AS l_per_100km, ' +
        'round(sum(driving_seconds) / 3600.0, 1) AS driving_hours, ' +
        'round(sum(km) / nullif(sum(driving_seconds) / 3600.0, 0), 1) AS avg_speed_kmh ' +
        `FROM v_trip_segments ${sql} GROUP BY 1 ORDER BY month`,
      params,
    ),
    FUEL_MONTH,
  )
}

export const tripSegments: Handler = async ({ con, q, range }) => {
  const limit = q.int('limit', 500, 1, 5000)
  const { sql, params } = range().clause('end_at')
  return shaped(
    await con.rows(`SELECT * FROM v_trip_segments ${sql} ORDER BY end_at DESC, start_at DESC LIMIT ?`, [...params, limit]),
    TRIP_SEGMENT,
  )
}

export const statusTimeline: Handler = async ({ con, range }) => {
  const { sql, params } = range().clause('created_at')
  return shaped(
    await con.rows(
      'SELECT created_at, odometer_km, fuel_level_pct, range_km, trip_km, engine_state, ' +
        'tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa ' +
        `FROM v_vehicle_status ${sql} ORDER BY created_at`,
      params,
    ),
    STATUS_POINT,
  )
}

/** Tire pressures by the time the car MEASURED them (see v_tire_readings), oldest first. */
export const tireReadings: Handler = async ({ con, range }) => {
  const { sql, params } = range().clause('reading_at')
  return shaped(
    await con.rows(
      'SELECT reading_at, time_known, first_snapshot_at, last_snapshot_at, snapshots, age_minutes, ' +
        'last_age_minutes, stale, tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa ' +
        `FROM v_tire_readings ${sql} ORDER BY reading_at, time_known`,
      params,
    ),
    TIRE_READING,
  )
}

export const doorsTimeline: Handler = async ({ con, q, range }) => {
  const limit = q.int('limit', 200, 1, 5000)
  const { sql, params } = range().clause('created_at')
  return shaped(
    await con.rows(`SELECT * FROM v_door_status ${sql} ORDER BY created_at DESC LIMIT ?`, [...params, limit]),
    DOOR_POINT,
  )
}

export const alarms: Handler = async ({ con, range }) => {
  const { sql, params } = range().clause('created_at')
  return shaped(await con.rows(`SELECT * FROM v_alarm_events ${sql} ORDER BY created_at DESC`, params), ALARM_EVENT)
}
