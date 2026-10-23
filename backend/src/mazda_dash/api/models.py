"""Response models. They double as the OpenAPI contract the frontend types are built from."""

from datetime import date, datetime

from pydantic import BaseModel


class Health(BaseModel):
    status: str
    database: str
    has_data: bool


class LatestStatus(BaseModel):
    at: datetime | None = None
    fuel_level_pct: float | None = None
    range_km: float | None = None
    tire_fl_kpa: float | None = None
    tire_fr_kpa: float | None = None
    tire_rl_kpa: float | None = None
    tire_rr_kpa: float | None = None


class AlarmEvent(BaseModel):
    created_at: datetime
    burglar_status: float | None = None
    alarm_reason: float | None = None


class Overview(BaseModel):
    vin: str | None = None
    odometer_km: float | None = None
    odometer_at: datetime | None = None
    data_from: datetime | None = None
    data_to: datetime | None = None
    range_from: date | None = None
    range_to: date | None = None
    has_data_in_range: bool = False
    km_in_range: float | None = None
    lifetime_l_per_100km: float | None = None
    l_per_100km_in_range: float | None = None
    status: LatestStatus
    warnings_total: int
    warnings_in_range: int
    active_faults: int
    faults_seen: int
    unmapped_codes: int
    alerts_new: int = 0
    last_alarm: AlarmEvent | None = None


class DataSpan(BaseModel):
    first_day: date | None = None
    last_day: date | None = None


class OdometerDay(BaseModel):
    day: date
    odometer_km: float
    km_since_previous: float | None = None
    days_since_previous: int | None = None


class FuelMonth(BaseModel):
    month: str
    segments: int
    km: float | None = None
    fuel_l: float | None = None
    l_per_100km: float | None = None
    driving_hours: float | None = None
    avg_speed_kmh: float | None = None


class TripSegment(BaseModel):
    start_at: datetime
    end_at: datetime
    gap_hours: float
    after_reset: bool
    km: float
    fuel_l: float
    driving_seconds: float | None = None
    odometer_delta_km: float | None = None
    fuel_level_pct: float | None = None
    l_per_100km: float | None = None


class StatusPoint(BaseModel):
    created_at: datetime
    odometer_km: float | None = None
    fuel_level_pct: float | None = None
    range_km: float | None = None
    trip_km: float | None = None
    engine_state: float | None = None
    tire_fl_kpa: float | None = None
    tire_fr_kpa: float | None = None
    tire_rl_kpa: float | None = None
    tire_rr_kpa: float | None = None


class DoorPoint(BaseModel):
    created_at: datetime
    door_driver: float | None = None
    door_passenger: float | None = None
    door_rear_left: float | None = None
    door_rear_right: float | None = None
    trunk: float | None = None
    hood: float | None = None
    lock_driver: float | None = None
    lock_passenger: float | None = None
    hazard_switch: float | None = None
    light_switch: float | None = None
    invalid_signals: int


class WarningFrequency(BaseModel):
    code: str
    title: str
    severity: str
    known: bool
    events: int
    pct_of_events: float
    days_seen: int
    first_seen: datetime
    last_seen: datetime


class WarningDay(BaseModel):
    day: date
    code: str
    events: int


class WarningEvent(BaseModel):
    transaction_id: str
    triggered_at: datetime | None = None
    odometer_km: float | None = None
    code: str
    title: str
    severity: str
    known: bool


class WarningPage(BaseModel):
    total: int
    items: list[WarningEvent]


class DtcFrequency(BaseModel):
    ecu: str
    ecu_title: str | None = None
    dtc_code: str
    failure_type: str | None = None
    title: str
    severity: str
    readouts: int
    first_seen: datetime
    last_seen: datetime
    first_odometer_km: float | None = None
    last_odometer_km: float | None = None
    active_in_latest_readout: bool


class DtcEvent(BaseModel):
    transaction_id: str
    event_at: datetime
    odometer_km: float | None = None
    ecu: str
    dtc_code: str
    failure_type: str | None = None
    title: str
    severity: str
    failure_type_title: str | None = None
    system: str | None = None
    confirmed: bool | None = None
    pending: bool | None = None
    test_failed: bool | None = None
    warning_indicator: bool | None = None


class Readout(BaseModel):
    transaction_id: str
    event_at: datetime
    odometer_km: float | None = None
    faults: int
    read_errors: int
    ecus_reported: int


class SnapshotSignal(BaseModel):
    transaction_id: str
    record_number: str | None = None
    snapshot_at: datetime | None = None
    odometer_km: float | None = None
    signal: str
    value: str | None = None
    value_num: float | None = None


class UnmappedCode(BaseModel):
    kind: str
    code: str
    occurrences: int


class Alert(BaseModel):
    alert_id: int
    rule: str
    severity: str
    title: str
    detail: str | None = None
    link: str | None = None
    occurred_at: datetime | None = None
    created_at: datetime
    status: str
    acknowledged_at: datetime | None = None


class Acknowledged(BaseModel):
    acknowledged: int


class DiagReportInfo(BaseModel):
    report_id: str
    source_file: str
    vin: str | None = None
    taken_at: datetime | None = None
    odometer_km: float | None = None
    values: int
    dtcs: int
    obd_tests: int


class DiagSummary(BaseModel):
    lifetime_km: float | None = None
    lifetime_fuel_l: float | None = None
    lifetime_l_per_100km: float | None = None
    recent_km: float | None = None
    recent_fuel_l: float | None = None
    recent_l_per_100km: float | None = None
    engine_hours: float | None = None
    ignition_cycles: float | None = None


class DiagValue(BaseModel):
    key: str
    value: str | None = None
    value_num: float | None = None
    unit: str | None = None


class DiagSection(BaseModel):
    ecu: str | None = None
    name: str
    items: list[DiagValue]


class DiagDtc(BaseModel):
    dtc_code: str
    failure_type: str | None = None
    status_byte: str | None = None
    title: str | None = None


class DiagDtcGroup(BaseModel):
    list_name: str
    ecu: str | None = None
    dtcs: list[DiagDtc]


class ObdTest(BaseModel):
    ecu: str | None = None
    obdmid: str
    test: str
    min_value: float | None = None
    max_value: float | None = None
    value: float | None = None
    unit: str | None = None
    in_range: bool | None = None
    position: float | None = None


class AesState(BaseModel):
    aes_id: str
    state: str | None = None


class DiagReport(BaseModel):
    info: DiagReportInfo
    summary: DiagSummary
    sections: list[DiagSection]
    dtc_lists: list[DiagDtcGroup]
    obd_tests: list[ObdTest]
    aes: list[AesState]


class DiagFrame(BaseModel):
    ecu: str | None = None
    dtc_code: str
    failure_type: str | None = None
    status_byte: str | None = None
    record_number: str | None = None
    signals: list[DiagValue]


class DiagDelta(BaseModel):
    ecu: str | None = None
    section: str | None = None
    key: str
    unit: str | None = None
    a: float
    b: float
    delta: float


class FrameSignal(BaseModel):
    signal: str
    value: str | None = None
    value_num: float | None = None


class FreezeFrame(BaseModel):
    frame_id: str
    record_number: str | None = None
    snapshot_at: datetime | None = None
    first_reported_at: datetime | None = None
    last_reported_at: datetime | None = None
    times_reported: int
    odometer_km: float | None = None
    signals: list[FrameSignal]


class ContextWarning(BaseModel):
    triggered_at: datetime
    code: str
    title: str
    severity: str


class ContextFault(BaseModel):
    ecu: str
    dtc_code: str
    failure_type: str | None = None
    title: str


class FaultContext(BaseModel):
    event_at: datetime | None = None
    odometer_km: float | None = None
    window_hours: float
    warnings: list[ContextWarning]
    other_faults: list[ContextFault]
    status: StatusPoint | None = None
    status_offset_minutes: float | None = None


class MonthMetrics(BaseModel):
    """One calendar month. Metrics are None when the month has no data for them (a gap, not 0)."""

    month: str  # YYYY-MM
    days_in_month: int
    days_covered: int  # days of this month inside the data span and the selected period
    partial: bool
    distance_km: float | None = None
    l_per_100km: float | None = None
    fuel_l_est: float | None = None
    drives: int | None = None
    days_driven: int | None = None
    driving_hours: float | None = None
    avg_speed_kmh: float | None = None
    warning_events: int | None = None
    warning_codes: int | None = None
    fault_readouts: int | None = None
    distinct_faults: int | None = None
    new_faults: int | None = None
    tire_avg_kpa: float | None = None
    tire_min_kpa: float | None = None
