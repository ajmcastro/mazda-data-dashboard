/** Diagnostic-tool reports (port of the second half of `api/app.py`). */
import type { Con } from './db'
import type { Handler } from './context'
import { HttpError, pick } from './http'
import { AES_STATE, DIAG_DELTA, DIAG_HISTORY, DIAG_REPORT_INFO, DIAG_SUMMARY, OBD_TEST } from './shapes'

const shaped = (rows: Record<string, unknown>[], fields: readonly string[]) => rows.map((r) => pick(r, fields))

const INFO_SQL =
  'SELECT r.report_id, r.source_file, r.vin, r.taken_at, r.odometer_km, ' +
  '(SELECT count(*) FROM diag_values v WHERE v.report_id = r.report_id) AS values, ' +
  '(SELECT count(*) FROM diag_dtcs d WHERE d.report_id = r.report_id) AS dtcs, ' +
  '(SELECT count(*) FROM diag_obd_tests t WHERE t.report_id = r.report_id) AS obd_tests ' +
  'FROM diag_reports r'

async function reportOr404(con: Con, reportId: string): Promise<Record<string, unknown>> {
  const info = await con.one(`${INFO_SQL} WHERE r.report_id = ?`, [reportId])
  if (!Object.keys(info).length) throw new HttpError(404, `No diagnostic report ${reportId}`)
  return info
}

export const diagReports: Handler = async ({ con }) =>
  shaped(await con.rows(`${INFO_SQL} ORDER BY r.taken_at DESC, r.source_file, r.report_id`), DIAG_REPORT_INFO)

/** Every diagnostic-tool report with its headline numbers, oldest first. */
export const diagHistory: Handler = async ({ con }) =>
  shaped(
    await con.rows(
      'SELECT r.report_id, r.source_file, r.taken_at, r.odometer_km, s.lifetime_km, ' +
        's.lifetime_fuel_l, s.lifetime_l_per_100km, s.engine_hours, s.ignition_cycles, ' +
        '(SELECT count(*) FROM v_diag_obd o WHERE o.report_id = r.report_id) AS monitors_total, ' +
        '(SELECT count(*) FROM v_diag_obd o WHERE o.report_id = r.report_id AND o.in_range) ' +
        'AS monitors_passed, ' +
        '(SELECT count(*) FROM diag_dtcs d WHERE d.report_id = r.report_id) AS dtcs_listed ' +
        'FROM diag_reports r LEFT JOIN v_diag_summary s USING (report_id) ' +
        'ORDER BY r.taken_at, r.source_file, r.report_id',
    ),
    DIAG_HISTORY,
  )

/** Groups rows by a key, keeping first-seen order (what a Python dict does). */
function group<T>(rows: T[], key: (r: T) => unknown[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = JSON.stringify(key(r))
    if (!out.has(k)) out.set(k, [])
    out.get(k)!.push(r)
  }
  return out
}

const value = (r: Record<string, unknown>, key: unknown) => ({
  key,
  value: r.value ?? null,
  value_num: r.value_num ?? null,
  unit: r.unit ?? null,
})

export const diagReport: Handler = async ({ con, path }) => {
  const id = path.report_id
  const info = await reportOr404(con, id)
  const summary = await con.one(
    'SELECT lifetime_km, lifetime_fuel_l, lifetime_l_per_100km, recent_km, recent_fuel_l, ' +
      'recent_l_per_100km, engine_hours, ignition_cycles FROM v_diag_summary WHERE report_id = ?',
    [id],
  )
  const valueRows = await con.rows(
    'SELECT ecu, section, seq, key, value, value_num, unit FROM diag_values ' +
      "WHERE report_id = ? AND section IS DISTINCT FROM 'AES ID and Status' ORDER BY rowid",
    [id],
  )
  const sections = [...group(valueRows, (r) => [r.ecu ?? null, r.section ?? 'General']).values()].map((items) => ({
    ecu: items[0].ecu ?? null,
    name: items[0].section ?? 'General',
    items: items.map((r) => value(r, r.seq === 1 ? r.key : `${r.key} #${r.seq}`)),
  }))
  const dtcRows = await con.rows(
    'SELECT d.list_name, d.ecu, d.dtc_code, d.failure_type, d.status_byte, c.title ' +
      'FROM diag_dtcs d LEFT JOIN ref_dtc_codes c ON c.dtc_code = d.dtc_code ' +
      'WHERE d.report_id = ? ORDER BY d.rowid',
    [id],
  )
  const dtcLists = [...group(dtcRows, (r) => [r.list_name ?? null, r.ecu ?? null]).values()].map((dtcs) => ({
    list_name: dtcs[0].list_name,
    ecu: dtcs[0].ecu ?? null,
    dtcs: shaped(dtcs, ['dtc_code', 'failure_type', 'status_byte', 'title']),
  }))
  return {
    info: pick(info, DIAG_REPORT_INFO),
    summary: pick(summary, DIAG_SUMMARY),
    sections,
    dtc_lists: dtcLists,
    obd_tests: shaped(
      await con.rows(
        'SELECT ecu, obdmid, test, min_value, max_value, value, unit, in_range, position ' +
          'FROM v_diag_obd WHERE report_id = ? ORDER BY ecu, obdmid, test, value, min_value, max_value, unit',
        [id],
      ),
      OBD_TEST,
    ),
    aes: shaped(await con.rows('SELECT aes_id, state FROM v_diag_aes WHERE report_id = ? ORDER BY seq', [id]), AES_STATE),
  }
}

export const diagReportFrames: Handler = async ({ con, path }) => {
  const id = path.report_id
  await reportOr404(con, id)
  const rows = await con.rows(
    'SELECT ecu, dtc_code, failure_type, status_byte, record_number, signal, value, value_num, unit ' +
      'FROM diag_snapshots WHERE report_id = ? ORDER BY rowid',
    [id],
  )
  return [...group(rows, (r) => [r.ecu ?? null, r.dtc_code, r.failure_type ?? null, r.record_number ?? null]).values()].map(
    (signals) => {
      const f = signals[0]
      return {
        ecu: f.ecu ?? null,
        dtc_code: f.dtc_code,
        failure_type: f.failure_type ?? null,
        status_byte: f.status_byte ?? null,
        record_number: f.record_number ?? null,
        signals: signals.map((r) => value(r, r.signal)),
      }
    },
  )
}

/** Numeric values present in both reports, with the change from `a` to `b`. */
export const diagCompare: Handler = async ({ con, q }) => {
  const a = q.required('a')
  const b = q.required('b')
  await reportOr404(con, a)
  await reportOr404(con, b)
  return shaped(
    await con.rows(
      "SELECT x.ecu, x.section, CASE WHEN x.seq = 1 THEN x.key ELSE x.key || ' #' || x.seq END AS key, " +
        'coalesce(y.unit, x.unit) AS unit, x.value_num AS a, y.value_num AS b, ' +
        'y.value_num - x.value_num AS delta ' +
        'FROM diag_values x JOIN diag_values y ON x.ecu IS NOT DISTINCT FROM y.ecu ' +
        'AND x.section IS NOT DISTINCT FROM y.section AND x.key = y.key AND x.seq = y.seq ' +
        'WHERE x.report_id = ? AND y.report_id = ? ' +
        'AND x.value_num IS NOT NULL AND y.value_num IS NOT NULL ORDER BY x.rowid',
      [a, b],
    ),
    DIAG_DELTA,
  )
}
