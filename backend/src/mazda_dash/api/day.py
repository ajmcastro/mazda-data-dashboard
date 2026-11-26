"""One day at a glance (PLAN.md M49): everything the exports say about one day of the car's LOCAL calendar
(``car_timezone``), in time order.

A state endpoint keyed by its own ``date`` (not the period); without one it answers for the newest day that has
anything. UTC to local is one ``timezone(zone, make_timestamptz(epoch_us(ts)))`` as in M35 (the in-browser
DuckDB cannot bind nested calls). Each kind of entry decides its day by one moment (``day_at``): a stretch of
driving and a fill-up by the LATER of their two reports (when they were seen), the rest by their own time.

The same SQL runs in the phone app (``mobile/src/engine/day.ts``): keep the two identical."""

from datetime import date

import duckdb

from . import models as m
from .db import has_table, one, rows

COLS = (
    'kind, at_utc AS "at", until_utc AS "until", code, title, severity, n, km, l_per_100km, odometer_km, '
    "fuel_level_pct, d_fuel_pct, tire_min_kpa, litres, doubtful, text, ref, engine_state, alarm_status, "
    "alarm_reason"
)
# every column of an entry, typed, so each kind names only what it has
NULLS = {
    "until_utc": "TIMESTAMP",
    "code": "VARCHAR",
    "title": "VARCHAR",
    "severity": "VARCHAR",
    "n": "BIGINT",
    "km": "DOUBLE",
    "l_per_100km": "DOUBLE",
    "odometer_km": "DOUBLE",
    "fuel_level_pct": "DOUBLE",
    "d_fuel_pct": "DOUBLE",
    "tire_min_kpa": "DOUBLE",
    "litres": "DOUBLE",
    "doubtful": "BOOLEAN",
    "text": "VARCHAR",
    "ref": "VARCHAR",
    # raw values that the documented meanings (M72) put into words on the page
    "engine_state": "DOUBLE",
    "alarm_status": "DOUBLE",
    "alarm_reason": "DOUBLE",
}


def _select(
    kind: str,
    order: int,
    day_at: str,
    at: str,
    source: str,
    fixed_day: str = "CAST(NULL AS DATE)",
    **cols: str,
) -> str:
    """One kind of entry: the columns it has, NULL for the rest."""
    fields = ", ".join(
        f"{cols.get(name, f'CAST(NULL AS {kind_})')} AS {name}"
        for name, kind_ in NULLS.items()
    )
    return f"SELECT '{kind}' AS kind, {order} AS ord, {day_at} AS day_at, {fixed_day} AS fixed_day, {at} AS at_utc, {fields} FROM {source}"


OPEN = (
    "concat_ws(', ', CASE WHEN door_driver <> 0 THEN 'driver door' END, "
    "CASE WHEN door_passenger <> 0 THEN 'passenger door' END, "
    "CASE WHEN door_rear_left <> 0 THEN 'rear left door' END, "
    "CASE WHEN door_rear_right <> 0 THEN 'rear right door' END, "
    "CASE WHEN trunk <> 0 THEN 'trunk' END, CASE WHEN hood <> 0 THEN 'hood' END)"
)
SOURCES = [
    # a stretch of driving, seen by the later of its two reports
    _select(
        "drive",
        1,
        "end_at",
        "start_at",
        "v_trip_segments",
        until_utc="end_at",
        km="round(km, 1)",
        l_per_100km="round(l_per_100km, 1)",
    ),
    # a warning code, once per day: how often, first and last
    _select(
        "warning",
        4,
        "triggered_at",
        "triggered_at",
        "(SELECT code, max(title) AS title, max(severity) AS severity, count(*) AS n, "
        "min(triggered_at) AS triggered_at, max(triggered_at) AS last_at, "
        "CAST(timezone(c.zone, make_timestamptz(epoch_us(triggered_at))) AS DATE) AS d "
        "FROM v_warnings CROSS JOIN cfg c WHERE triggered_at IS NOT NULL GROUP BY code, d) w",
        until_utc="last_at",
        code="code",
        title="title",
        severity="severity",
        n="n",
    ),
    # a fault read-out with the codes it listed
    _select(
        "readout",
        5,
        "event_at",
        "event_at",
        "(SELECT s.transaction_id, s.event_at, s.faults, s.odometer_km, "
        "(SELECT string_agg(e.dtc_code, ', ' ORDER BY e.dtc_code, e.ecu) FROM v_dtc_events e "
        "WHERE e.transaction_id = s.transaction_id) AS codes FROM v_dtc_readout_summary s "
        "WHERE s.event_at IS NOT NULL) r",
        n="faults",
        odometer_km="odometer_km",
        text="codes",
        ref="transaction_id",
    ),
    # a status report, with the fuel level against the report before
    _select(
        "status",
        2,
        "created_at",
        "created_at",
        "(SELECT created_at, odometer_km, fuel_level_pct, "
        "fuel_level_pct - lag(fuel_level_pct) OVER (ORDER BY created_at) AS d_fuel, "
        "odometer_km - lag(odometer_km) OVER (ORDER BY created_at) AS d_km, "
        "least(tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa) AS tire_min, engine_state "
        "FROM v_vehicle_status) s",
        km="round(d_km, 1)",
        odometer_km="odometer_km",
        fuel_level_pct="fuel_level_pct",
        d_fuel_pct="round(d_fuel, 1)",
        tire_min_kpa="tire_min",
        engine_state="engine_state",
    ),
    # doors, trunk and hood: only when what is open differs from the report before
    _select(
        "doors",
        3,
        "created_at",
        "created_at",
        f"(SELECT created_at, {OPEN} AS open, lag({OPEN}) OVER (ORDER BY created_at) AS before "
        "FROM v_door_status) d WHERE open IS DISTINCT FROM before AND (open <> '' OR before <> '')",
        text="open",
    ),
    _select(
        "alarm",
        6,
        "created_at",
        "created_at",
        "v_alarm_events",
        text="'status ' || CAST(CAST(burglar_status AS BIGINT) AS VARCHAR) || ', reason ' || "
        "CAST(CAST(alarm_reason AS BIGINT) AS VARCHAR)",
        alarm_status="burglar_status",
        alarm_reason="alarm_reason",
    ),
    # a fill-up, seen by the later of its two reports
    _select(
        "fill_up",
        7,
        "after_at",
        "before_at",
        "v_refuels",
        until_utc="after_at",
        litres="round(litres, 1)",
        fuel_level_pct="level_after",
        d_fuel_pct="round(points, 1)",
        doubtful="doubtful",
    ),
    _select(
        "diag",
        8,
        "taken_at",
        "taken_at",
        "diag_reports WHERE taken_at IS NOT NULL",
        odometer_km="odometer_km",
        ref="report_id",
    ),
]
ALERTS = _select(
    "alert",
    9,
    "occurred_at",
    "occurred_at",
    "alerts WHERE occurred_at IS NOT NULL",
    code="rule",
    title="title",
    severity="severity",
    text="detail",
    ref="dedup_key",
)


# an entry of the service log: a day, not a moment, so it comes first on its day
SERVICE = _select(
    "service",
    0,
    "CAST(served_on AS TIMESTAMP)",
    "CAST(NULL AS TIMESTAMP)",
    "ref_service_log",
    fixed_day="served_on",
    code="kind",
    text="note",
    odometer_km="odometer_km",
    n="n",
)


def base_sql(with_alerts: bool, with_service: bool = False) -> str:
    """The CTEs every query starts with: `ev` = every entry of all time with its local day."""
    sources = (
        SOURCES
        + ([ALERTS] if with_alerts else [])
        + ([SERVICE] if with_service else [])
    )
    return (
        "WITH cfg AS (SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone "
        "FROM ref_settings), src AS (" + " UNION ALL ".join(sources) + "), "
        "ev AS (SELECT s.*, coalesce(s.fixed_day, CAST(timezone(c.zone, make_timestamptz(epoch_us(s.day_at))) "
        "AS DATE)) AS local_day, "
        "timezone(c.zone, make_timestamptz(epoch_us(s.at_utc))) AS local_at, "
        "timezone(c.zone, make_timestamptz(epoch_us(s.until_utc))) AS local_until FROM src s CROSS JOIN cfg c) "
    )


def day(con: duckdb.DuckDBPyConnection, on: date | None) -> m.Day:
    base = base_sql(has_table(con, "alerts"), has_table(con, "ref_service_log"))
    zone = one(
        con,
        "SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone FROM ref_settings",
    )["zone"]
    span = one(
        con,
        base + "SELECT strftime(min(local_day), '%Y-%m-%d') AS first_day, "
        "strftime(max(local_day), '%Y-%m-%d') AS last_day FROM ev",
    )
    chosen = on.isoformat() if on else span["last_day"]
    if chosen is None:  # nothing in the database at all
        return m.Day(date=None, time_zone=zone, entries=[])
    around = one(
        con,
        base + "SELECT strftime(max(local_day) FILTER (WHERE local_day < "
        "CAST(? AS DATE)), '%Y-%m-%d') AS previous, strftime(min(local_day) FILTER "
        "(WHERE local_day > CAST(? AS DATE)), '%Y-%m-%d') AS next FROM ev",
        [chosen, chosen],
    )
    entries = rows(
        con,
        base + f"SELECT {COLS}, strftime(local_at, '%Y-%m-%d %H:%M') AS local, "
        "strftime(local_until, '%Y-%m-%d %H:%M') AS local_until FROM ev "
        "WHERE local_day = CAST(? AS DATE) "
        "ORDER BY day_at, ord, at_utc, code, ref, n, text",
        [chosen],
    )
    return m.Day(date=chosen, time_zone=zone, **span, **around, entries=entries)
