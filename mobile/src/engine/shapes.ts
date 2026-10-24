/** Field lists of the response models in `api/models.py`; a model drops other columns and nulls missing ones. */

export const ODOMETER_DAY = ['day', 'odometer_km', 'km_since_previous', 'days_since_previous']
export const FUEL_MONTH = ['month', 'segments', 'km', 'fuel_l', 'l_per_100km', 'driving_hours', 'avg_speed_kmh']
export const TRIP_SEGMENT = [
  'start_at', 'end_at', 'gap_hours', 'after_reset', 'km', 'fuel_l', 'driving_seconds', 'odometer_delta_km',
  'fuel_level_pct', 'l_per_100km',
]
export const STATUS_POINT = [
  'created_at', 'odometer_km', 'fuel_level_pct', 'range_km', 'trip_km', 'engine_state', 'tire_fl_kpa',
  'tire_fr_kpa', 'tire_rl_kpa', 'tire_rr_kpa',
]
export const DOOR_POINT = [
  'created_at', 'door_driver', 'door_passenger', 'door_rear_left', 'door_rear_right', 'trunk', 'hood',
  'lock_driver', 'lock_passenger', 'hazard_switch', 'light_switch', 'invalid_signals',
]
export const ALARM_EVENT = ['created_at', 'burglar_status', 'alarm_reason']
export const LATEST_STATUS = [
  'at', 'fuel_level_pct', 'range_km', 'tire_fl_kpa', 'tire_fr_kpa', 'tire_rl_kpa', 'tire_rr_kpa',
  'tire_measured_at', 'tire_age_minutes', 'tire_stale',
]
export const TIRE_READING = [
  'reading_at', 'time_known', 'first_snapshot_at', 'last_snapshot_at', 'snapshots', 'age_minutes',
  'last_age_minutes', 'stale', 'tire_fl_kpa', 'tire_fr_kpa', 'tire_rl_kpa', 'tire_rr_kpa',
]
export const WARNING_FREQUENCY = [
  'code', 'title', 'severity', 'known', 'events', 'pct_of_events', 'days_seen', 'first_seen', 'last_seen',
]
export const WARNING_DAY = ['day', 'code', 'events']
export const WARNING_EVENT = ['transaction_id', 'triggered_at', 'odometer_km', 'code', 'title', 'severity', 'known']
export const DTC_FREQUENCY = [
  'ecu', 'ecu_title', 'dtc_code', 'failure_type', 'title', 'severity', 'readouts', 'first_seen', 'last_seen',
  'first_odometer_km', 'last_odometer_km', 'active_in_latest_readout',
]
export const DTC_EVENT = [
  'transaction_id', 'event_at', 'odometer_km', 'ecu', 'dtc_code', 'failure_type', 'title', 'severity',
  'failure_type_title', 'system', 'confirmed', 'pending', 'test_failed', 'warning_indicator',
]
export const READOUT = ['transaction_id', 'event_at', 'odometer_km', 'faults', 'read_errors', 'ecus_reported']
export const SNAPSHOT_SIGNAL = ['transaction_id', 'record_number', 'snapshot_at', 'odometer_km', 'signal', 'value', 'value_num']
export const UNMAPPED_CODE = ['kind', 'code', 'occurrences']
export const ALERT = [
  'alert_id', 'rule', 'severity', 'title', 'detail', 'link', 'occurred_at', 'created_at', 'status', 'acknowledged_at',
]
export const DIAG_REPORT_INFO = ['report_id', 'source_file', 'vin', 'taken_at', 'odometer_km', 'values', 'dtcs', 'obd_tests']
export const DIAG_SUMMARY = [
  'lifetime_km', 'lifetime_fuel_l', 'lifetime_l_per_100km', 'recent_km', 'recent_fuel_l', 'recent_l_per_100km',
  'engine_hours', 'ignition_cycles',
]
export const OBD_TEST = ['ecu', 'obdmid', 'test', 'min_value', 'max_value', 'value', 'unit', 'in_range', 'position']
export const AES_STATE = ['aes_id', 'state']
export const DIAG_HISTORY = [
  'report_id', 'source_file', 'taken_at', 'odometer_km', 'lifetime_km', 'lifetime_fuel_l', 'lifetime_l_per_100km',
  'engine_hours', 'ignition_cycles', 'monitors_total', 'monitors_passed', 'dtcs_listed',
]
export const DIAG_DELTA = ['ecu', 'section', 'key', 'unit', 'a', 'b', 'delta']
export const CONTEXT_WARNING = ['triggered_at', 'code', 'title', 'severity']
export const CONTEXT_FAULT = ['ecu', 'dtc_code', 'failure_type', 'title']
export const MONTH_METRICS = [
  'month', 'days_in_month', 'days_covered', 'partial', 'distance_km', 'l_per_100km', 'fuel_l_est', 'drives',
  'days_driven', 'driving_hours', 'avg_speed_kmh', 'warning_events', 'warning_codes', 'fault_readouts',
  'distinct_faults', 'new_faults', 'tire_avg_kpa', 'tire_min_kpa',
]
export const OIL_STEP = ['read_at', 'odometer_km', 'remaining_km', 'serviced']
export const CAR_WARNING_FLAG = ['flag', 'label', 'is_on', 'value', 'last_read_at', 'readings', 'episodes', 'since']
export const CAR_WARNING_EPISODE = ['flag', 'label', 'started_at', 'last_on_at', 'readings', 'max_value', 'ongoing']
