"""Response models. They double as the OpenAPI contract the frontend types are built from."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class Health(BaseModel):
    status: str
    database: str
    has_data: bool
    writable: bool = False  # this server may edit the model's own files (the service log); never the phone


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
    shape: str = (
        "generic"  # the outline the 3D drawing uses (SHAPES in mazda_dash/models.py)
    )


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
    oil_date_first: str | None = (
        None  # the forecast's two dates (M52); None without a countdown or a pace
    )
    oil_date_last: str | None = None
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
    dedup_key: str | None = (
        None  # the rule's own key (a wheel, a flag, a code): what the alert is about (M55)
    )
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
    rear_left_readings: int = (
        0  # belted readings with that rear belt buckled (M57: the seats)
    )
    rear_right_readings: int = 0
    driver_only_readings: int  # belted readings with no other belt buckled
    months: list[OccupancyMonth]


class Refuel(BaseModel):
    """A fill-up: a rise of the fuel level between two consecutive status snapshots (PLAN.md M47). When it
    happened is only known to lie between the two."""

    before_at: datetime  # the last snapshot before it
    after_at: datetime  # the first snapshot after it
    level_before: float  # fuel level in points of the gauge (%)
    level_after: float
    points: float  # the rise
    gap_hours: float  # the time between the two snapshots
    odometer_km: float | None = None
    doubtful: bool  # a small rise, or one seen across a long silence
    litres: float | None = (
        None  # needs tank_litres; a lower bound (fuel burned in between is not seen)
    )
    km_since_previous: float | None = None
    used_since_previous_l: float | None = (
        None  # by the gauge, from the previous fill-up to this one
    )
    l_per_100km_since_previous: float | None = None
    est_cost: float | None = None  # litres x the price in force that day: an estimate
    paid: float | None = None  # what the owner noted paying (fuel_log.yaml)
    paid_litres: float | None = None
    payments: int = 0  # how many noted payments it adds up


class FuelPayment(BaseModel):
    """A payment in the fuel log that no fill-up was seen around."""

    paid_on: date
    paid: float
    litres: float | None = None


class Refuels(BaseModel):
    tank_litres: float | None = (
        None  # settings.yaml; without it there are no litres or costs
    )
    min_points: float  # a rise under this is doubtful
    currency: str | None = None
    fill_ups: int
    doubtful: int
    litres: float | None = None  # of the fill-ups listed
    est_cost: float | None = None
    paid: float | None = None  # only of the fill-ups that have a payment
    paid_fill_ups: int
    refuels: list[Refuel]  # newest first
    unmatched: list[FuelPayment]


class ImportedFile(BaseModel):
    name: str
    kind: str  # war, dtc-h, dtc-d, dtc-ssr, rts, vis, alt, diag
    status: str  # added, or "already there" (the same content is in the folder)
    saved_as: str | None = (
        None  # the name in the data folder (a short hash is added when the name was taken)
    )


class ImportedRows(BaseModel):
    kind: str
    label: str
    rows: int


class ImportSummary(BaseModel):
    """What one upload changed: the Mac only (the phone gets packs)."""

    imported_at: str
    source: str
    files: list[ImportedFile]
    rows_new: list[ImportedRows]  # only the kinds that gained rows
    newest_day_before: str | None = None
    newest_day_after: str | None = None
    km_since: float | None = None  # the odometer now less before the load
    faults_appeared: list[str]  # in the latest read-out now, not before
    faults_cleared: list[str]
    new_warning_codes: list[str]
    new_alerts: list[str]  # their titles
    open_alerts: int


class Forecast(BaseModel):
    """What the recent pace says about the oil change and the year's distance. Everything is counted from
    `as_of`, the newest day with data, never from today."""

    has_data: bool
    as_of: str | None = None  # the car's local day, YYYY-MM-DD
    odometer_km: float | None = None
    km_per_day_30d: float | None = (
        None  # None: the readings span less than half the window
    )
    km_per_day_90d: float | None = None
    km_per_year: int | None = (
        None  # the 90-day pace (the 30-day one without it) over a year, to 100 km
    )
    oil_left_km: float | None = (
        None  # the car's countdown less what was driven since; None: not sent
    )
    oil_days_first: int | None = None  # at the faster of the two paces
    oil_days_last: int | None = None
    oil_date_first: str | None = None
    oil_date_last: str | None = None
    mileage_limit_km: float | None = None  # settings.yaml `mileage`
    year_start: str | None = None  # the year that contains `as_of`
    year_end: str | None = None
    year_km: float | None = None  # so far this year
    year_counted_from: str | None = (
        None  # when the data starts over a week into the year
    )
    year_projected_km: int | None = None  # at the pace, by `year_end`, to 100 km
    year_over_km: int | None = None  # projected less the limit (negative: under)


class WheelForecast(BaseModel):
    wheel: str  # fl, fr, rl, rr
    measurements: int  # in the window, since a refill if there was one
    span_days: float
    current_kpa: float | None = None  # the wheel's newest measurement
    last_at: datetime | None = None
    refilled_at: datetime | None = None  # the series restarts at a refill
    enough: bool  # enough measurements over enough days for a rate
    kpa_per_week: float | None = (
        None  # against the mean of the other three; negative = losing
    )
    losing: bool
    below_limit: bool  # losing and already at or under the limit
    days_left: int | None = (
        None  # to the limit at this rate; None when it is far or not losing
    )
    reaches_limit_on: str | None = None  # YYYY-MM-DD


class TireForecast(BaseModel):
    limit_kpa: float  # the low-pressure alert's limit (alerts.yaml)
    window_days: int
    min_measurements: int
    min_span_days: int
    wheels: list[
        WheelForecast
    ]  # always in the order fl, fr, rl, rr; empty without measurements


class ServiceEntry(BaseModel):
    date: str  # the car's local day, YYYY-MM-DD
    kind: str  # oil_change, tires, service, software, repair, other
    note: str
    odometer_km: float | None = None


class ServiceSuggestion(BaseModel):
    """Something the data hints at that the log does not have; offered, never added."""

    kind: str
    reason: str  # oil_countdown (it went up) or diagnostic_report (one was taken)
    date: str  # the day it was seen
    odometer_km: float | None = None


class ServiceLog(BaseModel):
    kinds: list[str]
    entries: list[ServiceEntry]  # newest first
    suggestions: list[ServiceSuggestion]


class ServiceEntryIn(BaseModel):
    date: str
    kind: str
    note: str
    odometer_km: float | None = None


class ServiceAdded(BaseModel):
    added: bool  # false: the file already had this entry
    entries: int  # in the log now


class DayEntry(BaseModel):
    """One thing that happened on a day. `kind` says which fields are filled: drive, status, doors, warning,
    readout, alarm, fill_up, diag, alert, service."""

    kind: str
    at: datetime | None = None  # UTC; a drive's or a fill-up's EARLIER report
    until: datetime | None = (
        None  # a drive's or a fill-up's later report; a warning's last time
    )
    local: str | None = None  # `at` in the car's time zone, "YYYY-MM-DD HH:MM"
    local_until: str | None = None
    code: str | None = None  # warning code; an alert's rule
    title: str | None = None
    severity: str | None = None
    n: int | None = None  # warnings of that code; faults in a read-out
    km: float | None = (
        None  # a drive's distance; a status report's distance since the report before
    )
    l_per_100km: float | None = None
    odometer_km: float | None = None
    fuel_level_pct: float | None = None
    d_fuel_pct: float | None = None  # against the report before; a fill-up's rise
    tire_min_kpa: float | None = None
    litres: float | None = None
    doubtful: bool | None = None
    text: str | None = (
        None  # what is open; fault codes; an alarm's raw codes; an alert's detail
    )
    ref: str | None = None  # read-out transaction id, report id, alert key


class Day(BaseModel):
    date: str | None = (
        None  # the car's local day, YYYY-MM-DD; None for an empty database
    )
    time_zone: str
    first_day: str | None = None
    last_day: str | None = None
    previous: str | None = None  # the nearest day with anything before / after this one
    next: str | None = None
    entries: list[DayEntry]


class DrivingBand(BaseModel):
    band: str  # under_5, 5_to_20, 20_to_100, over_100
    min_km: float
    max_km: float | None = None
    stretches: int
    km: float
    fuel_l: float
    l_per_100km: float | None = None  # only from min_km on


class DrivingBandTotal(DrivingBand):
    driving_hours: float
    avg_speed_kmh: float | None = None


class DrivingMonth(BaseModel):
    month: str  # YYYY-MM
    stretches: int  # every stretch of the month, as on Trends
    km: float
    fuel_l: float
    l_per_100km: float | None = None
    bands: list[DrivingBand]  # the stretches put in a band


class DrivingUnclassified(BaseModel):
    stretches: int
    km: float


class DrivingPattern(BaseModel):
    """Stretches of driving (between two consecutive status reports) by length."""

    gap_hours: int  # a stretch whose reports are this far apart is not put in a band
    min_km: int  # a consumption is given only from this distance on
    stretches: int  # put in a band
    km: float
    fuel_l: float
    l_per_100km: float | None = None
    driving_hours: float
    avg_speed_kmh: float | None = None
    unclassified: DrivingUnclassified
    bands: list[DrivingBandTotal]  # always the four
    months: list[DrivingMonth]


class DataKind(BaseModel):
    """One kind of export file (named as in Mazda's file names) and what it covers in the period."""

    kind: str  # war | dtc-h | dtc-d | dtc-ssr | rts | vis | alt | diag
    first_at: datetime | None = None
    last_at: datetime | None = None
    records: int  # events, read-outs, reports; for rts / vis / alt the status snapshots
    days: int  # days with at least one record


class DataGap(BaseModel):
    """A silence between two consecutive status reports."""

    from_at: datetime
    to_at: datetime
    hours: float


class InvalidSignal(BaseModel):
    """A signal the car flagged Invalid at least once (the dashboard never trusts such a reading)."""

    source: str  # rts | vis | alt
    signal: str
    readings: int
    invalid: int
    pct: float


class DataHealth(BaseModel):
    """How much the loaded data can be trusted in a period (PLAN.md M46). Nothing here is a judgement of
    the car: it describes the exports."""

    has_data: bool
    range_from: date | None = (
        None  # the days looked at: the period, or the span of the data
    )
    range_to: date | None = None
    days_in_range: int
    snapshots: int  # status reports in the period
    days_with_status: int  # days with at least one
    gap_threshold_hours: float  # a silence at least this long is listed in `gaps`
    gaps_total: int  # how many there are (`gaps` lists the longest)
    longest_gap_hours: float | None = None
    median_gap_hours: float | None = None  # the usual time between two status reports
    signals_checked: int  # signals whose validity was looked at
    readings_checked: int
    invalid_readings: int
    kinds: list[DataKind]
    gaps: list[DataGap]  # longest first
    invalid: list[InvalidSignal]  # highest share first


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
