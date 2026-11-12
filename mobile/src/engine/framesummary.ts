/** How one fault's freeze frames compare with all other faults' (port of `frame_summary` in `api/app.py`, M36). */
import type { Handler } from './context'
import { pick } from './http'
import { FRAME_SIGNAL_SUMMARY } from './shapes'

// (signal in the car's data, label, unit): the same list and order as FRAME_SUMMARY_SIGNALS in Python
const SIGNALS: [string, string, string][] = [
  ['Main_ECU_Voltage_Supply', 'Battery voltage (main ECU supply)', 'V'],
  ['ECU_Power_Voltage', 'ECU power voltage', 'V'],
  ['SOC_StateOfCharge', 'Battery charge', '%'],
  ['Engine_Coolant_Temperature', 'Coolant temperature', '°C'],
  ['Vehicle_Speed', 'Vehicle speed', 'km/h'],
]
// the baseline needs this many frames of other faults before a position is claimed
const FRAME_BASELINE_MIN = 10

export const frameSummary: Handler = async ({ con, q }) => {
  const ecu = q.required('ecu')
  const dtcCode = q.required('dtc_code')
  const names = SIGNALS.map((s) => s[0])
  const marks = names.map(() => '?').join(', ')
  const counts = await con.one(
    'SELECT count(*) FILTER (WHERE ecu = ? AND dtc_code = ?) AS frames, ' +
      'count(*) FILTER (WHERE NOT (ecu = ? AND dtc_code = ?)) AS baseline_frames ' +
      'FROM (SELECT DISTINCT ecu, dtc_code, record_number, snapshot_at FROM v_frame_signals)',
    [ecu, dtcCode, ecu, dtcCode],
  )
  const stats = await con.rows(
    `SELECT signal,
            count(*) FILTER (WHERE mine) AS frames,
            round(min(value_num) FILTER (WHERE mine), 2) AS min,
            round(median(value_num) FILTER (WHERE mine), 2) AS median,
            round(max(value_num) FILTER (WHERE mine), 2) AS max,
            count(*) FILTER (WHERE NOT mine) AS baseline_frames,
            round(min(value_num) FILTER (WHERE NOT mine), 2) AS baseline_min,
            round(median(value_num) FILTER (WHERE NOT mine), 2) AS baseline_median,
            round(max(value_num) FILTER (WHERE NOT mine), 2) AS baseline_max,
            round(quantile_cont(value_num, 0.1) FILTER (WHERE NOT mine), 2) AS baseline_p10,
            round(quantile_cont(value_num, 0.9) FILTER (WHERE NOT mine), 2) AS baseline_p90,
            CASE WHEN count(*) FILTER (WHERE NOT mine) >= ${FRAME_BASELINE_MIN}
                      AND quantile_cont(value_num, 0.1) FILTER (WHERE NOT mine)
                          < quantile_cont(value_num, 0.9) FILTER (WHERE NOT mine)
                 THEN CASE
                     WHEN median(value_num) FILTER (WHERE mine)
                          <= quantile_cont(value_num, 0.1) FILTER (WHERE NOT mine) THEN 'low'
                     WHEN median(value_num) FILTER (WHERE mine)
                          >= quantile_cont(value_num, 0.9) FILTER (WHERE NOT mine) THEN 'high'
                 END
            END AS position
     FROM (SELECT signal, value_num, (ecu = ? AND dtc_code = ?) AS mine
           FROM (SELECT DISTINCT ecu, dtc_code, record_number, snapshot_at, signal, value_num
                 FROM v_frame_signals)
           WHERE value_num IS NOT NULL AND signal IN (${marks}))
     GROUP BY signal HAVING count(*) FILTER (WHERE mine) > 0`,
    [ecu, dtcCode, ...names],
  )
  const bySignal = new Map(stats.map((r) => [r.signal as string, r]))
  return {
    ecu,
    dtc_code: dtcCode,
    frames: counts.frames,
    baseline_frames: counts.baseline_frames,
    signals: SIGNALS.filter(([name]) => bySignal.has(name)).map(([name, label, unit]) =>
      pick({ ...bySignal.get(name)!, label, unit }, FRAME_SIGNAL_SUMMARY),
    ),
  }
}
