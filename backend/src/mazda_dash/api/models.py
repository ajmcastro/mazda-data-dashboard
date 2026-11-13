"""Response models. They double as the OpenAPI contract the frontend types are built from."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class Health(BaseModel):
    status: str
    database: str
    has_data: bool


class ModelBody(BaseModel):
    """A model's outer dimensions (mm) and steering side, from `body:` in its model.yaml. The 3D drawing of the
    car uses them; a dimension that is not given is drawn in proportion to a generic car."""

    length_mm: float | None = None
    width_mm: float | None = None
    height_mm: float | None = None
    wheelbase_mm: float | None = None
    track_mm: float | None = None
    wheel_diameter_mm: float | None = None
    steering: Literal["left", "right"] = "left"


class ModelInfo(BaseModel):
    id: str
    name: str
    platform: str | None = None
    default: bool
    hidden_pages: list[str] = []
    body: ModelBody | None = None
    has_data: bool
    first_day: date | None = None
    last_day: date | None = None


class Garage(BaseModel):
    """One car's headline figures for the "All cars" page. State figures (alerts, faults, oil, car warnings)
    are the latest; the distance is for the 30 days up to the newest day with data."""

    has_data: bool
    vin: str | None = None
    odometer_km: float | None = None
    odometer_at: datetime | None = None
    last_reading_at: datetime | None = None  # the newest data point of any kind
    from_day: date | None = None  # the 30 days the distance is for
    to_day: date | None = None
    km_last_30_days: float | None = None
    fuel_level_pct: float | None = None
    range_km: float | None = None
    # fuel and cost of the same 30 days (estimates: distance x the average, see the overview and Trends)
    fuel_l_30d: float | None = None
    l_per_100km_30d: float | None = None
    fuel_cost_30d: float | None = None  # None without a fuel price
    cost_per_100km_30d: float | None = None
    currency: str | None = None  # of the cost figures
    oil_remaining_km: float | None = None
    oil_read_at: datetime | None = None
    alerts_new: int = 0
    active_faults: int = 0
    car_warnings_on: list[
        str
    ] = []  # labels of the car's own warning flags that are on now


class LatestStatus(BaseModel):
    at: datetime | None = None
    fuel_level_pct: float | None = None
    range_km: float | None = None
    tire_fl_kpa: float | None = None
    tire_fr_kpa: float | None = None
    tire_rl_kpa: float | None = None
    tire_rr_kpa: float | None = None
    tire_measured_at: datetime | None = None  # when the car measured them (UTC)
    tire_age_minutes: float | None = (
        None  # how much older than `at` the measurement was
    )
    tire_stale: bool | None = None


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
    cost_per_100km_in_range: float | None = (
        None  # estimate; None when no fuel price is set
    )
    currency: str | None = None
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


class TireReading(BaseModel):
    """One tire-pressure MEASUREMENT (snapshots that repeat it are folded into it)."""

    reading_at: datetime  # when it was measured (UTC); the first snapshot's time if time_known is false
    time_known: bool
    first_snapshot_at: datetime
    last_snapshot_at: datetime
    snapshots: int
    age_minutes: float | None = None  # age of the measurement when first seen
    last_age_minutes: float | None = None  # ... and when last seen
    stale: bool | None = None
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


class ActivityHour(BaseModel):
    hour: int  # 0-23, the car's local time
    active_days: int  # distinct local days with a warning or a drive in this hour
    warning_codes: int  # distinct warning codes raised in this hour
    km: float
    drives: int


class ActivityWeekday(BaseModel):
    weekday: int  # 0 = Monday ... 6 = Sunday, the car's local time
    calendar_days: int  # days of this weekday between the first and the last activity in the period
    active_days: int  # of those, days with a warning or a drive
    warning_days: int
    km: float


class ActivityPattern(BaseModel):
    time_zone: str
    hours: list[ActivityHour]  # empty when the period has no activity
    weekdays: list[ActivityWeekday]


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


class FrameSignalSummary(BaseModel):
    signal: str
    label: str
    unit: str | None = None
    frames: int  # this fault's distinct frames that have a value for the signal
    min: float | None = None
    median: float | None = None
    max: float | None = None
    baseline_frames: int  # frames of all OTHER faults with a value
    baseline_min: float | None = None
    baseline_median: float | None = None
    baseline_max: float | None = None
    baseline_p10: float | None = None
    baseline_p90: float | None = None
    # where this fault's median sits among the other faults' frames: at or below their lowest tenth ("low"),
    # at or above their highest tenth ("high"), or null (in between, too few frames, or no spread)
    position: Literal["low", "high"] | None = None


class FaultFrameSummary(BaseModel):
    ecu: str
    dtc_code: str
    frames: int  # distinct freeze frames of this fault that have signal values
    baseline_frames: int  # the same for all other faults
    signals: list[FrameSignalSummary]


class OccupancyMonth(BaseModel):
    month: str
    belted_readings: int
    passenger_readings: int
    rear_readings: int


class Occupancy(BaseModel):
    available: bool  # the car sent the driver's belt in the period
    readings: int  # status snapshots with a valid driver's belt value
    belted_readings: (
        int  # of those, with the driver's belt buckled: the base of every share
    )
    passenger_readings: int  # belted readings with the front passenger's belt buckled
    rear_readings: int  # belted readings with a rear belt (left or right) buckled
    driver_only_readings: int  # belted readings with no other belt buckled
    months: list[OccupancyMonth]


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


class OilStep(BaseModel):
    """A change of the car's oil countdown (the car counts in coarse steps)."""

    read_at: datetime
    odometer_km: float | None = None
    remaining_km: float
    serviced: bool  # the countdown went up: an oil change


class OilService(BaseModel):
    """The car's own countdown to the next oil change (not a calculation)."""

    has_data: bool
    remaining_km: float | None = None
    read_at: datetime | None = None
    odometer_km: float | None = None  # at that reading
    km_since_reading: float | None = (
        None  # driven since, up to the newest odometer value
    )
    interval_started_at: datetime | None = None
    intervals: int = 0  # service intervals seen (1 + number of oil changes)
    steps: list[OilStep]


class CarWarningFlag(BaseModel):
    """One of the car's own warning flags: its latest state (0 = all clear)."""

    flag: str
    label: str
    is_on: bool
    value: float | None = None  # the raw value of the latest reading
    last_read_at: datetime
    readings: int
    episodes: int  # runs of consecutive readings with the flag on
    since: datetime | None = None  # when the current run began, if it is on now


class CarWarningEpisode(BaseModel):
    flag: str
    label: str
    started_at: datetime
    last_on_at: datetime
    readings: int
    max_value: float
    ongoing: bool


class CarWarnings(BaseModel):
    has_data: bool
    all_clear: bool
    flags: list[CarWarningFlag]
    episodes: list[CarWarningEpisode]  # newest first


class WarningFlag(BaseModel):
    """One of the car's 128 warning-lamp bit flags (only flags that ever change are listed)."""

    flag: str
    area: str  # powertrain | body
    bit: int
    title: str | None = (
        None  # your description, from config/models/<id>/codes/warning_flags.yaml
    )
    severity: str
    notes: str | None = None
    readings: int
    readings_on: int
    pct_on: float
    first_on_at: datetime | None = None
    last_on_at: datetime | None = None
    on_now: bool
    max_value: float
    first_on_report_day: bool  # first set on a day a diagnostic report was taken
    episodes: int


class WarningFlagEpisode(BaseModel):
    flag: str
    started_at: datetime
    last_on_at: datetime
    readings: int
    max_value: float
    ongoing: bool


class WarningFlags(BaseModel):
    has_data: bool
    first_read_at: datetime | None = None
    last_read_at: datetime | None = None
    flags: list[WarningFlag]
    episodes: list[WarningFlagEpisode]


class FlagHintWarning(BaseModel):
    code: str
    title: str
    severity: str
    known: bool
    on_with: int  # readings with the flag on that have this warning code nearby
    off_with: int
    share_on: float | None = None  # on_with / all readings with the flag on
    share_off: float | None = None


class FlagHintFault(BaseModel):
    ecu: str
    dtc_code: str
    failure_type: str | None = None
    title: str
    severity: str
    on_with: int
    off_with: int
    share_on: float | None = None
    share_off: float | None = None


class WarningFlagHints(BaseModel):
    """What happens around the times a flag is on. A hint to research from, NOT a meaning."""

    flag: str
    window_hours: float
    on_readings: int
    off_readings: int
    warnings: list[FlagHintWarning]
    faults: list[FlagHintFault]


class MonthMetrics(BaseModel):
    """One calendar month. Metrics are None when the month has no data for them (a gap, not 0)."""

    month: str  # YYYY-MM
    days_in_month: int
    days_covered: int  # days of this month inside the data span and the selected period
    partial: bool
    distance_km: float | None = None
    l_per_100km: float | None = None
    fuel_l_est: float | None = None
    currency: str | None = None  # of the cost figures; None when no fuel price is set
    cost_per_100km: float | None = (
        None  # estimate: reported litres x the price you entered
    )
    fuel_cost_est: float | None = None  # estimate, like fuel_l_est
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


class DiagHistoryPoint(BaseModel):
    """One diagnostic report, summarised so reports made at different times can be compared."""

    report_id: str
    source_file: str
    taken_at: datetime | None = None
    odometer_km: float | None = None
    lifetime_km: float | None = None
    lifetime_fuel_l: float | None = None
    lifetime_l_per_100km: float | None = None
    engine_hours: float | None = None
    ignition_cycles: float | None = None
    monitors_total: int
    monitors_passed: int
    dtcs_listed: int
