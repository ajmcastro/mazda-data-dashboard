/** Fault (DTC) endpoints, freeze frames and the fault context (port of the middle of `api/app.py`). */
import type { Handler } from './context'
import { Ts } from './db'
import { HttpError, pick } from './http'
import {
  CONTEXT_FAULT, CONTEXT_WARNING, DTC_EVENT, DTC_FREQUENCY, READOUT, SNAPSHOT_SIGNAL, STATUS_POINT,
} from './shapes'

const shaped = (rows: Record<string, unknown>[], fields: readonly string[]) => rows.map((r) => pick(r, fields))

export const dtcFrequency: Handler = async ({ con, range }) => {
  // Per fault: read-outs and first/last seen within the range. Faults still active in the latest
  // read-out are always listed (that is a state), with all-time dates if not reported in the range.
  const { sql, params } = range().clause('event_at')
  return shaped(
    await con.rows(
      `WITH everything AS (
                SELECT ecu, dtc_code, failure_type, any_value(ecu_title) AS ecu_title,
                       any_value(title) AS title, any_value(severity) AS severity,
                       min(event_at) AS first_seen, max(event_at) AS last_seen,
                       min(odometer_km) AS first_odometer_km, max(odometer_km) AS last_odometer_km,
                       bool_or(transaction_id = (SELECT transaction_id FROM dtc_headers
                                                 ORDER BY copied_at DESC LIMIT 1)) AS active
                FROM v_dtc_events GROUP BY ecu, dtc_code, failure_type),
            inside AS (
                SELECT ecu, dtc_code, failure_type, count(DISTINCT transaction_id) AS readouts,
                       min(event_at) AS first_seen, max(event_at) AS last_seen,
                       min(odometer_km) AS first_odometer_km, max(odometer_km) AS last_odometer_km
                FROM v_dtc_events ${sql} GROUP BY ecu, dtc_code, failure_type)
            SELECT e.ecu, e.ecu_title, e.dtc_code, e.failure_type, e.title, e.severity,
                   coalesce(i.readouts, 0) AS readouts,
                   coalesce(i.first_seen, e.first_seen) AS first_seen,
                   coalesce(i.last_seen, e.last_seen) AS last_seen,
                   coalesce(i.first_odometer_km, e.first_odometer_km) AS first_odometer_km,
                   coalesce(i.last_odometer_km, e.last_odometer_km) AS last_odometer_km,
                   e.active AS active_in_latest_readout
            FROM everything e LEFT JOIN inside i USING (ecu, dtc_code, failure_type)
            WHERE i.readouts > 0 OR e.active
            ORDER BY e.active DESC, last_seen DESC, e.ecu, e.dtc_code, e.failure_type`,
      params,
    ),
    DTC_FREQUENCY,
  )
}

export const dtcEvents: Handler = async ({ con, q, range }) => {
  const ecu = q.str('ecu')
  const dtcCode = q.str('dtc_code')
  const limit = q.int('limit', 500, 1, 5000)
  const { conds, params } = range().conds('event_at')
  for (const [col, val] of [['ecu', ecu], ['dtc_code', dtcCode]] as const) {
    if (val) {
      conds.push(`${col} = ?`)
      params.push(val)
    }
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return shaped(
    await con.rows(
      'SELECT transaction_id, event_at, odometer_km, ecu, dtc_code, failure_type, title, severity, ' +
        'failure_type_title, system, confirmed, pending, test_failed, warning_indicator ' +
        `FROM v_dtc_events ${where} ORDER BY event_at DESC, ecu, dtc_code LIMIT ?`,
      [...params, limit],
    ),
    DTC_EVENT,
  )
}

export const dtcReadouts: Handler = async ({ con, range }) => {
  const { sql, params } = range().clause('event_at')
  return shaped(
    await con.rows(
      'SELECT transaction_id, event_at, odometer_km, faults, read_errors, ecus_reported ' +
        `FROM v_dtc_readout_summary ${sql} ORDER BY event_at DESC, transaction_id`,
      params,
    ),
    READOUT,
  )
}

export const dtcSnapshots: Handler = async ({ con, q }) => {
  const ecu = q.required('ecu')
  const dtcCode = q.required('dtc_code')
  return shaped(
    await con.rows(
      'SELECT transaction_id, record_number, snapshot_at, odometer_km, signal, value, value_num ' +
        'FROM v_dtc_snapshot_signals WHERE ecu = ? AND dtc_code = ? ' +
        'ORDER BY snapshot_at DESC NULLS LAST, record_number, signal',
      [ecu, dtcCode],
    ),
    SNAPSHOT_SIGNAL,
  )
}

/** Distinct freeze frames of a DTC, newest first, each with its signals. */
export const freezeFrames: Handler = async ({ con, q }) => {
  const ecu = q.required('ecu')
  const dtcCode = q.required('dtc_code')
  const frames = await con.rows(
    'SELECT ecu, dtc_code, record_number, snapshot_at, first_reported_at, last_reported_at, ' +
      'times_reported, odometer_km FROM v_freeze_frames WHERE ecu = ? AND dtc_code = ? ' +
      'ORDER BY snapshot_at DESC NULLS LAST, record_number',
    [ecu, dtcCode],
  )
  const signals = new Map<string, Map<string, Record<string, unknown>>>()
  for (const r of await con.rows(
    'SELECT record_number, snapshot_at, signal, value, value_num FROM v_dtc_snapshot_signals ' +
      'WHERE ecu = ? AND dtc_code = ? ORDER BY signal',
    [ecu, dtcCode],
  )) {
    // the same frame repeats across read-outs with identical values; keep one copy
    const key = JSON.stringify([r.record_number, r.snapshot_at])
    if (!signals.has(key)) signals.set(key, new Map())
    const frame = signals.get(key)!
    if (!frame.has(r.signal as string)) {
      frame.set(r.signal as string, { signal: r.signal, value: r.value ?? null, value_num: r.value_num ?? null })
    }
  }
  return frames.map((f) => ({
    // 20260630T101500 style stamp of the snapshot time
    frame_id: f.snapshot_at
      ? `${f.record_number}@${String(f.snapshot_at).slice(0, 19).replace(/[-:]/g, '')}`
      : `${f.record_number}@unknown`,
    record_number: f.record_number ?? null,
    snapshot_at: f.snapshot_at ?? null,
    first_reported_at: f.first_reported_at ?? null,
    last_reported_at: f.last_reported_at ?? null,
    times_reported: f.times_reported,
    odometer_km: f.odometer_km ?? null,
    signals: [...(signals.get(JSON.stringify([f.record_number, f.snapshot_at]))?.values() ?? [])],
  }))
}

/** What else was going on around a fault read-out: nearby warnings, the other faults in the same read-out and the closest status snapshot. */
export const faultContext: Handler = async ({ con, q }) => {
  const transactionId = q.required('transaction_id')
  const windowHours = q.float('window_hours', 2, 0, 48)
  const head = await con.one(
    'SELECT coalesce(triggered_at, copied_at) AS event_at, odometer_km FROM dtc_headers WHERE transaction_id = ?',
    [transactionId],
  )
  if (!Object.keys(head).length) throw new HttpError(404, `No read-out ${transactionId}`)
  // event_at as a naive timestamp literal; the window arithmetic stays in SQL (microsecond exact)
  const at = new Ts(String(head.event_at).replace('T', ' ').replace('Z', ''))
  const margin = Math.round(windowHours * 3_600_000_000)
  const warnings = await con.rows(
    'SELECT triggered_at, code, title, severity FROM v_warnings ' +
      `WHERE triggered_at BETWEEN ? - to_microseconds(${margin}) AND ? + to_microseconds(${margin}) ORDER BY triggered_at`,
    [at, at],
  )
  const others = await con.rows(
    'SELECT ecu, dtc_code, failure_type, title FROM v_dtc_events WHERE transaction_id = ? ORDER BY ecu, dtc_code',
    [transactionId],
  )
  const status = await con.one(
    'SELECT created_at, odometer_km, fuel_level_pct, range_km, trip_km, engine_state, tire_fl_kpa, ' +
      'tire_fr_kpa, tire_rl_kpa, tire_rr_kpa, ' +
      'abs(date_diff(\'second\', created_at, ?)) / 60.0 AS offset_minutes FROM v_vehicle_status ' +
      "WHERE abs(date_diff('second', created_at, ?)) <= 3 * 3600 " +
      "ORDER BY abs(date_diff('second', created_at, ?)) LIMIT 1",
    [at, at, at],
  )
  const offset = status.offset_minutes
  delete status.offset_minutes
  return {
    event_at: head.event_at ?? null,
    odometer_km: head.odometer_km ?? null,
    window_hours: windowHours,
    warnings: shaped(warnings, CONTEXT_WARNING),
    other_faults: shaped(others, CONTEXT_FAULT),
    status: Object.keys(status).length ? pick(status, STATUS_POINT) : null,
    status_offset_minutes: offset ?? null,
  }
}
