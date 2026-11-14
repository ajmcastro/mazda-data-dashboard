"""How much the loaded data can be trusted (PLAN.md M46): what each export covers, where the status
reports fall silent, and which signals the car itself flags as Invalid.

It reads tables and views that already exist; nothing new is stored. The same SQL runs in the phone app
(``mobile/src/engine/datahealth.ts``): keep the two identical. Of the remote-status source (``rts``) only
the signals a view reads by name are judged, because those are the only ones the phone's data pack carries
(``pack.used_signals``); GPS positions are never looked at."""

from datetime import date, datetime

import duckdb

from ..pack import GPS_SIGNALS, TRIMMED_SOURCE, used_signals
from . import models as m
from .dates import DateRange
from .db import one, rows

# A silence between two status reports at least this long is listed as a gap.
GAP_HOURS = 48
MAX_GAPS = 20

_SNAPSHOTS = "(SELECT DISTINCT created_at FROM signal_readings WHERE source = '{}') t"
# (kind as in Mazda's file names, where its records are, the time of a record)
DATA_KINDS = [
    ("war", "warning_events", "triggered_at"),
    ("dtc-h", "dtc_headers", "triggered_at"),
    ("dtc-d", "v_dtc_events", "event_at"),
    ("dtc-ssr", "dtc_snapshots", "triggered_at"),
    ("rts", _SNAPSHOTS.format("rts"), "created_at"),
    ("vis", _SNAPSHOTS.format("vis"), "created_at"),
    ("alt", _SNAPSHOTS.format("alt"), "created_at"),
    ("diag", "diag_reports", "taken_at"),
]


def _day(value: datetime | None) -> date | None:
    return value.date() if value else None


def data_health(con: duckdb.DuckDBPyConnection, rng: DateRange) -> m.DataHealth:
    kinds = []
    for kind, source, ts in DATA_KINDS:
        where, params = rng.clause(ts, "AND")
        found = one(
            con,
            f"SELECT min({ts}) AS first_at, max({ts}) AS last_at, count(*) AS records, "
            f"count(DISTINCT CAST({ts} AS DATE)) AS days FROM {source} WHERE {ts} IS NOT NULL {where}",
            params,
        )
        kinds.append(m.DataKind(kind=kind, **found))
    firsts = [k.first_at for k in kinds if k.first_at]
    lasts = [k.last_at for k in kinds if k.last_at]
    # the days looked at: the chosen period, or the span of the data when none is chosen
    range_from = rng.start or _day(min(firsts, default=None))
    range_to = rng.end or _day(max(lasts, default=None))
    days = (range_to - range_from).days + 1 if range_from and range_to else 0

    where, params = rng.clause("created_at")
    status = one(
        con,
        "SELECT count(*) AS snapshots, count(DISTINCT CAST(created_at AS DATE)) AS days_with_status "
        f"FROM v_vehicle_status {where}",
        params,
    )
    silences = (
        "WITH s AS (SELECT created_at, lag(created_at) OVER (ORDER BY created_at) AS previous "
        f"FROM v_vehicle_status {where}), "
        "g AS (SELECT previous AS from_at, created_at AS to_at, "
        "date_diff('second', previous, created_at) AS seconds FROM s WHERE previous IS NOT NULL) "
    )
    threshold = GAP_HOURS * 3600
    gap_stats = one(
        con,
        silences + "SELECT round(max(seconds) / 3600.0, 1) AS longest_gap_hours, "
        "round(median(seconds) / 3600.0, 1) AS median_gap_hours, "
        "count(*) FILTER (WHERE seconds >= ?) AS gaps_total FROM g",
        [*params, threshold],
    )
    gaps = rows(
        con,
        silences
        + "SELECT from_at, to_at, round(seconds / 3600.0, 1) AS hours FROM g WHERE seconds >= ? "
        "ORDER BY seconds DESC, from_at LIMIT ?",
        [*params, threshold, MAX_GAPS],
    )

    judged = used_signals()
    marks = ", ".join("?" for _ in judged)
    skip = ", ".join("?" for _ in GPS_SIGNALS)
    in_range, range_params = rng.clause("created_at", "AND")
    which = (
        f"FROM signal_readings WHERE (source <> ? OR signal IN ({marks})) "
        f"AND signal NOT IN ({skip}) {in_range}"
    )
    which_params = [TRIMMED_SOURCE, *judged, *GPS_SIGNALS, *range_params]
    is_invalid = "count(*) FILTER (WHERE valid IS FALSE)"
    totals = one(
        con,
        f"SELECT count(DISTINCT source || '/' || signal) AS signals_checked, count(*) AS readings_checked, "
        f"{is_invalid} AS invalid_readings {which}",
        which_params,
    )
    invalid = rows(
        con,
        f"SELECT source, signal, count(*) AS readings, {is_invalid} AS invalid, "
        f"round(100.0 * {is_invalid} / count(*), 1) AS pct {which} "
        f"GROUP BY source, signal HAVING {is_invalid} > 0 "
        "ORDER BY pct DESC, invalid DESC, source, signal",
        which_params,
    )
    return m.DataHealth(
        has_data=any(k.records for k in kinds),
        range_from=range_from,
        range_to=range_to,
        days_in_range=days,
        gap_threshold_hours=GAP_HOURS,
        kinds=kinds,
        gaps=gaps,
        invalid=invalid,
        **status,
        **gap_stats,
        **totals,
    )
