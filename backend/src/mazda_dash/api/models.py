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
    km_last_30_days: float | None = None
    lifetime_l_per_100km: float | None = None
    recent_l_per_100km: float | None = None
    status: LatestStatus
    warnings_total: int
    warnings_last_30_days: int
    active_faults: int
    faults_seen: int
    unmapped_codes: int
    last_alarm: AlarmEvent | None = None


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
