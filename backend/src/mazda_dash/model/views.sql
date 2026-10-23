-- Domain views. All timestamps are naive UTC. Recreated by `make model`.

CREATE OR REPLACE MACRO hex2int(s) AS
    (instr('0123456789ABCDEF', upper(substr(s, 1, 1))) - 1) * 16
    + (instr('0123456789ABCDEF', upper(substr(s, 2, 1))) - 1);

-- ---------------------------------------------------------------- warnings
CREATE OR REPLACE VIEW v_warnings AS
SELECT w.transaction_id, w.triggered_at, w.copied_at, w.odometer_km,
       c.code,
       coalesce(r.title, 'Unknown warning ' || c.code) AS title,
       coalesce(r.severity, 'unknown') AS severity,
       r.category,
       r.title IS NOT NULL AS known
FROM warning_codes c
JOIN warning_events w USING (transaction_id)
LEFT JOIN ref_warning_codes r ON r.code = c.code;

CREATE OR REPLACE VIEW v_warning_frequency AS
SELECT code, any_value(title) AS title, any_value(severity) AS severity,
       bool_or(known) AS known,
       count(*) AS events,
       round(100.0 * count(*) / (SELECT count(*) FROM warning_events), 1) AS pct_of_events,
       count(DISTINCT CAST(triggered_at AS DATE)) AS days_seen,
       min(triggered_at) AS first_seen, max(triggered_at) AS last_seen
FROM v_warnings
GROUP BY code;

-- --------------------------------------------------------------------- DTCs
-- One row per ECU per read-out in which a well-formed DTC was reported.
CREATE OR REPLACE VIEW v_dtc_events AS
SELECT d.transaction_id,
       coalesce(h.triggered_at, h.copied_at) AS event_at,
       h.copied_at, h.odometer_km,
       d.ecu, e.title AS ecu_title,
       d.dtc_code, d.failure_type, d.raw_dtc,
       coalesce(r.title, 'Unknown DTC ' || d.dtc_code) AS title,
       coalesce(r.severity, 'unknown') AS severity,
       r.title IS NOT NULL AS known,
       f.title AS failure_type_title,
       CASE substr(replace(d.dtc_code, 'X', ''), 1, 1)
            WHEN 'P' THEN 'Powertrain' WHEN 'C' THEN 'Chassis'
            WHEN 'B' THEN 'Body' WHEN 'U' THEN 'Network' END AS system,
       CASE WHEN d.dtc_code LIKE 'X%' OR substr(d.dtc_code, 2, 1) <> '0'
            THEN 'other' ELSE 'generic' END AS scope,
       d.display_status,
       -- UDS status byte (ISO 14229): bit3 confirmed, bit2 pending, bit0 test failed, bit7 MIL
       CASE WHEN d.display_status IS NULL THEN NULL
            ELSE (hex2int(d.display_status) & 8) > 0 END AS confirmed,
       CASE WHEN d.display_status IS NULL THEN NULL
            ELSE (hex2int(d.display_status) & 4) > 0 END AS pending,
       CASE WHEN d.display_status IS NULL THEN NULL
            ELSE (hex2int(d.display_status) & 1) > 0 END AS test_failed,
       CASE WHEN d.display_status IS NULL THEN NULL
            ELSE (hex2int(d.display_status) & 128) > 0 END AS warning_indicator
FROM dtc_readings d
JOIN dtc_headers h USING (transaction_id)
LEFT JOIN ref_dtc_codes r ON r.dtc_code = d.dtc_code
LEFT JOIN ref_ecus e ON e.ecu = d.ecu
LEFT JOIN ref_failure_types f ON f.failure_type = d.failure_type
WHERE d.kind = 'fault';

-- Occurrence summary per ECU + DTC. `active_in_latest_readout` is true when the
-- most recent read-out of the whole car still lists the DTC.
CREATE OR REPLACE VIEW v_dtc_frequency AS
SELECT ecu, any_value(ecu_title) AS ecu_title, dtc_code, failure_type,
       any_value(title) AS title, any_value(severity) AS severity,
       count(DISTINCT transaction_id) AS readouts,
       min(event_at) AS first_seen, max(event_at) AS last_seen,
       min(odometer_km) AS first_odometer_km, max(odometer_km) AS last_odometer_km,
       bool_or(transaction_id = (SELECT transaction_id FROM dtc_headers
                                 ORDER BY copied_at DESC LIMIT 1)) AS active_in_latest_readout
FROM v_dtc_events
GROUP BY ecu, dtc_code, failure_type;

-- Read-out health: how often reads failed (raw protocol text instead of a DTC).
CREATE OR REPLACE VIEW v_dtc_readout_summary AS
SELECT h.transaction_id, coalesce(h.triggered_at, h.copied_at) AS event_at, h.copied_at,
       h.odometer_km,
       count(*) FILTER (WHERE d.kind = 'fault') AS faults,
       count(*) FILTER (WHERE d.kind = 'read_error') AS read_errors,
       count(*) AS ecus_reported
FROM dtc_headers h
LEFT JOIN dtc_readings d USING (transaction_id)
GROUP BY ALL;

-- Freeze-frame signals joined to their DTC.
CREATE OR REPLACE VIEW v_dtc_snapshot_signals AS
SELECT s.transaction_id, s.ecu, s.dtc_code, s.failure_type, s.record_number,
       s.snapshot_at, s.triggered_at, s.odometer_km,
       v.signal, v.value, v.value_num
FROM dtc_snapshots s
JOIN dtc_snapshot_values v USING (transaction_id, ecu, raw_dtc, record_number);

-- ---------------------------------------------------------- vehicle status
-- One row per remote-status snapshot (rts). Invalid readings become NULL.
CREATE OR REPLACE VIEW v_vehicle_status AS
SELECT created_at,
       max(value_num) FILTER (WHERE signal = 'ododispvalue' AND valid IS NOT FALSE) AS odometer_km,
       max(value_num) FILTER (WHERE signal = 'fuelsegementdactl' AND valid IS NOT FALSE)
           AS fuel_level_pct,
       max(value_num) FILTER (WHERE signal = 'smaphremdrvdistnum' AND valid IS NOT FALSE)
           AS range_km,
       max(value_num) FILTER (WHERE signal = 'drv1distnc' AND valid IS NOT FALSE) AS trip_km,
       max(value_num) FILTER (WHERE signal = 'drv1drvtm' AND valid IS NOT FALSE) AS trip_seconds,
       max(value_num) FILTER (WHERE signal = 'drv1avlfuele' AND valid IS NOT FALSE) AS trip_km_per_l,
       max(value_num) FILTER (WHERE signal = 'drv1avlfuelg' AND valid IS NOT FALSE)
           AS trip_l_per_100km_raw,
       max(value_num) FILTER (WHERE signal = 'enginestate' AND valid IS NOT FALSE) AS engine_state,
       max(value_num) FILTER (WHERE signal = 'fltprsdispkp' AND valid IS NOT FALSE) AS tire_fl_kpa,
       max(value_num) FILTER (WHERE signal = 'frtprsdispkp' AND valid IS NOT FALSE) AS tire_fr_kpa,
       max(value_num) FILTER (WHERE signal = 'rltprsdispkp' AND valid IS NOT FALSE) AS tire_rl_kpa,
       max(value_num) FILTER (WHERE signal = 'rrtprsdispkp' AND valid IS NOT FALSE) AS tire_rr_kpa
FROM signal_readings
WHERE source = 'rts'
GROUP BY created_at;

-- Door / lock / lights snapshots (vis). NULL where the car flagged the value Invalid.
CREATE OR REPLACE VIEW v_door_status AS
SELECT created_at,
       max(value_num) FILTER (WHERE signal = 'drstatdrv' AND valid IS NOT FALSE) AS door_driver,
       max(value_num) FILTER (WHERE signal = 'drstatpsngr' AND valid IS NOT FALSE) AS door_passenger,
       max(value_num) FILTER (WHERE signal = 'drstatrl' AND valid IS NOT FALSE) AS door_rear_left,
       max(value_num) FILTER (WHERE signal = 'drstatrr' AND valid IS NOT FALSE) AS door_rear_right,
       max(value_num) FILTER (WHERE signal = 'drstattrnklg' AND valid IS NOT FALSE) AS trunk,
       max(value_num) FILTER (WHERE signal = 'drstathood' AND valid IS NOT FALSE) AS hood,
       max(value_num) FILTER (WHERE signal = 'locklinkswdrv' AND valid IS NOT FALSE) AS lock_driver,
       max(value_num) FILTER (WHERE signal = 'locklinkswpsngr' AND valid IS NOT FALSE)
           AS lock_passenger,
       max(value_num) FILTER (WHERE signal = 'hazardsw' AND valid IS NOT FALSE) AS hazard_switch,
       max(value_num) FILTER (WHERE signal = 'lghtswstate' AND valid IS NOT FALSE) AS light_switch,
       count(*) FILTER (WHERE valid IS FALSE) AS invalid_signals
FROM signal_readings
WHERE source = 'vis'
GROUP BY created_at;

-- Burglar alarm status readings (alt).
CREATE OR REPLACE VIEW v_alarm_events AS
SELECT created_at,
       max(value_num) FILTER (WHERE signal = 'burglarstatus') AS burglar_status,
       max(value_num) FILTER (WHERE signal = 'balarmreasondactl') AS alarm_reason
FROM signal_readings
WHERE source = 'alt'
GROUP BY created_at;

-- ----------------------------------------------------------------- odometer
-- Every odometer value in any source, with the time it applies to.
CREATE OR REPLACE VIEW v_odometer_readings AS
SELECT created_at AS read_at, odometer_km, 'status' AS source FROM v_vehicle_status
WHERE odometer_km IS NOT NULL
UNION ALL
SELECT triggered_at, odometer_km, 'warning' FROM warning_events
WHERE odometer_km IS NOT NULL AND triggered_at IS NOT NULL
UNION ALL
SELECT triggered_at, odometer_km, 'dtc' FROM dtc_headers
WHERE odometer_km IS NOT NULL AND triggered_at IS NOT NULL
UNION ALL
SELECT taken_at, odometer_km, 'diag' FROM diag_reports
WHERE odometer_km IS NOT NULL AND taken_at IS NOT NULL;

CREATE OR REPLACE VIEW v_odometer_daily AS
WITH d AS (
    SELECT CAST(read_at AS DATE) AS day, max(odometer_km) AS odometer_km
    FROM v_odometer_readings GROUP BY 1
)
SELECT day, odometer_km,
       odometer_km - lag(odometer_km) OVER (ORDER BY day) AS km_since_previous,
       day - lag(day) OVER (ORDER BY day) AS days_since_previous
FROM d;

-- ------------------------------------------------------------------- trips
-- The car's "trip 1" counters accumulate until reset: trip_km, average economy and
-- driving time. Fuel used so far = trip_km * l/100km / 100 (the 102.2 raw value
-- means "no data" and is dropped when the trip is 0 km).
CREATE OR REPLACE VIEW v_trip_log AS
SELECT created_at, odometer_km, fuel_level_pct, trip_km, trip_seconds, engine_state,
       CASE WHEN trip_km > 0 THEN trip_l_per_100km_raw END AS trip_l_per_100km,
       CASE WHEN trip_km > 0 THEN trip_km * trip_l_per_100km_raw / 100 ELSE 0 END AS trip_fuel_l
FROM v_vehicle_status
WHERE trip_km IS NOT NULL;

-- Consumption between consecutive status snapshots (segments telescope within a trip,
-- so summing them is unbiased even though single segments are noisy; km from before a
-- reset that no snapshot saw are lost, so segment km is below the odometer delta). If the trip counter went down it
-- was reset in between, so the whole counter value belongs to this segment.
CREATE OR REPLACE VIEW v_trip_segments AS
WITH x AS (
    SELECT *,
           lag(created_at) OVER w AS prev_at,
           lag(trip_km) OVER w AS prev_km,
           lag(trip_fuel_l) OVER w AS prev_fuel,
           lag(trip_seconds) OVER w AS prev_seconds,
           lag(odometer_km) OVER w AS prev_odometer
    FROM v_trip_log WINDOW w AS (ORDER BY created_at)
), y AS (
    SELECT *, trip_km < prev_km AS after_reset FROM x WHERE prev_at IS NOT NULL
)
SELECT prev_at AS start_at, created_at AS end_at,
       date_diff('second', prev_at, created_at) / 3600.0 AS gap_hours,
       after_reset,
       trip_km - CASE WHEN after_reset THEN 0 ELSE prev_km END AS km,
       trip_fuel_l - CASE WHEN after_reset THEN 0 ELSE prev_fuel END AS fuel_l,
       trip_seconds - CASE WHEN after_reset THEN 0 ELSE prev_seconds END AS driving_seconds,
       odometer_km - prev_odometer AS odometer_delta_km,
       fuel_level_pct,
       -- per-segment economy is only meaningful over a few km (the car rounds its averages)
       CASE WHEN trip_km - CASE WHEN after_reset THEN 0 ELSE prev_km END >= 5
            THEN 100 * (trip_fuel_l - CASE WHEN after_reset THEN 0 ELSE prev_fuel END)
                 / (trip_km - CASE WHEN after_reset THEN 0 ELSE prev_km END) END AS l_per_100km
FROM y
WHERE trip_km - CASE WHEN after_reset THEN 0 ELSE prev_km END > 0;

CREATE OR REPLACE VIEW v_fuel_monthly AS
SELECT strftime(date_trunc('month', end_at), '%Y-%m') AS month,
       count(*) AS segments,
       round(sum(km), 1) AS km,
       round(sum(fuel_l), 1) AS fuel_l,
       round(100 * sum(fuel_l) / nullif(sum(km), 0), 2) AS l_per_100km,
       round(sum(driving_seconds) / 3600.0, 1) AS driving_hours,
       round(sum(km) / nullif(sum(driving_seconds) / 3600.0, 0), 1) AS avg_speed_kmh
FROM v_trip_segments
GROUP BY 1;

-- --------------------------------------------------------- diagnostic tool
CREATE OR REPLACE VIEW v_diag_values AS
SELECT r.report_id, r.taken_at, r.odometer_km AS report_odometer_km,
       v.ecu, v.section, v.seq, v.key, v.value, v.value_num, v.unit
FROM diag_values v JOIN diag_reports r USING (report_id);

-- Lifetime (_L) and since-reset (_R) distance, fuel and run time per report.
CREATE OR REPLACE VIEW v_diag_summary AS
SELECT report_id, taken_at, report_odometer_km,
       max(value_num) FILTER (WHERE key = 'DT_L') AS lifetime_km,
       max(value_num) FILTER (WHERE key = 'FC_L') AS lifetime_fuel_l,
       round(100 * max(value_num) FILTER (WHERE key = 'FC_L')
             / nullif(max(value_num) FILTER (WHERE key = 'DT_L'), 0), 2) AS lifetime_l_per_100km,
       max(value_num) FILTER (WHERE key = 'DT_R') AS recent_km,
       max(value_num) FILTER (WHERE key = 'FC_R') AS recent_fuel_l,
       round(100 * max(value_num) FILTER (WHERE key = 'FC_R')
             / nullif(max(value_num) FILTER (WHERE key = 'DT_R'), 0), 2) AS recent_l_per_100km,
       max(value_num) FILTER (WHERE key = 'ERT_L') / 3600.0 AS engine_hours,
       max(value_num) FILTER (WHERE key = 'IGNCNTR_L') AS ignition_cycles
FROM v_diag_values
GROUP BY ALL;

-- Mode 6 on-board monitor results; a value outside [min, max] is a failed test.
CREATE OR REPLACE VIEW v_diag_obd AS
SELECT t.report_id, r.taken_at, t.ecu, t.obdmid, t.test, t.min_value, t.max_value, t.value, t.unit,
       t.value BETWEEN t.min_value AND t.max_value AS in_range,
       -- where the value sits inside its limits: 0 = at min, 1 = at max (NULL if limits are equal)
       (t.value - t.min_value) / nullif(t.max_value - t.min_value, 0) AS position
FROM diag_obd_tests t JOIN diag_reports r USING (report_id);

-- Active emission-system (AES) ids: the tool prints id / state pairs.
CREATE OR REPLACE VIEW v_diag_aes AS
SELECT report_id, seq,
       max(value) FILTER (WHERE key = 'AESIDx') AS aes_id,
       max(value) FILTER (WHERE key = 'AESIDx_Activity_State') AS state
FROM diag_values WHERE section = 'AES ID and Status' GROUP BY report_id, seq;

-- One row per distinct freeze frame. The car re-reports the same frame in many read-outs,
-- so frames are keyed by when they were captured, not by read-out.
CREATE OR REPLACE VIEW v_freeze_frames AS
SELECT ecu, dtc_code, failure_type, record_number, snapshot_at,
       count(DISTINCT transaction_id) AS times_reported,
       min(coalesce(triggered_at, copied_at)) AS first_reported_at,
       max(coalesce(triggered_at, copied_at)) AS last_reported_at,
       min(odometer_km) AS odometer_km
FROM dtc_snapshots
GROUP BY ecu, dtc_code, failure_type, record_number, snapshot_at;

-- ----------------------------------------------------------- housekeeping
-- Codes seen in the data that have no description yet (fill them in config/codes).
CREATE OR REPLACE VIEW v_unmapped_codes AS
SELECT 'warning' AS kind, code AS code, count(*) AS occurrences
FROM v_warnings WHERE NOT known GROUP BY code
UNION ALL
SELECT 'dtc', dtc_code, count(*) FROM v_dtc_events WHERE NOT known GROUP BY dtc_code
UNION ALL
SELECT 'ecu', d.ecu, count(*) FROM dtc_readings d
LEFT JOIN ref_ecus e ON e.ecu = d.ecu
WHERE e.title IS NULL GROUP BY d.ecu;
