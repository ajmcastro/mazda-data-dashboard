"""Unusual status reports (PLAN.md M64): the reports least like this car's other reports, from the view
``v_unusual_reasons`` (``views.sql`` explains each feature, the robust z-score and the rarity rule).

What is usual is learned from ALL the car's data; the period only decides which reports are listed. A report
can have several reasons. "Unlike the car's other reports" is all it says: never a fault or a cause.

The same SQL runs in the phone app (``mobile/src/engine/unusual.ts``): keep the two identical."""

import duckdb

from . import models as m
from .dates import DateRange
from .db import one, rows

MIN_REPORTS = 30
THRESHOLD_Z = 3.5
RARE_PCT = 1.0

CFG = "(SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone FROM ref_settings)"
REASONS_SQL = (
    "SELECT r.created_at AS at, r.kind, "
    "strftime(timezone(c.zone, make_timestamptz(epoch_us(r.created_at))), '%Y-%m-%d %H:%M') AS local, "
    "r.feature, r.value, r.label, r.share_pct, r.z, r.usual_low, r.usual_high "
    f"FROM v_unusual_reasons r CROSS JOIN {CFG} c "
    "{where} ORDER BY r.created_at DESC, r.kind, r.feature"
)
COUNTS_SQL = (
    "SELECT (SELECT count(*) FROM v_vehicle_status {status}) AS status_reports, "
    "(SELECT count(*) FROM v_door_status {doors}) AS doors_reports, "
    "(SELECT count(*) FROM v_vehicle_status) AS status_all, "
    "(SELECT count(*) FROM v_door_status) AS doors_all"
)
REASON_FIELDS = (
    "feature",
    "value",
    "label",
    "share_pct",
    "z",
    "usual_low",
    "usual_high",
)


def unusual_reports(con: duckdb.DuckDBPyConnection, rng: DateRange) -> m.UnusualReports:
    where, params = rng.clause("r.created_at")
    found: list[dict] = []
    for r in rows(con, REASONS_SQL.format(where=where), params):
        if not found or (found[-1]["at"], found[-1]["kind"]) != (r["at"], r["kind"]):
            found.append(
                {"at": r["at"], "kind": r["kind"], "local": r["local"], "reasons": []}
            )
        found[-1]["reasons"].append({k: r[k] for k in REASON_FIELDS})
    status, status_params = rng.clause("created_at")
    counts = one(
        con,
        COUNTS_SQL.format(status=status, doors=status),
        [*status_params, *status_params],
    )
    return m.UnusualReports(
        min_reports=MIN_REPORTS,
        threshold_z=THRESHOLD_Z,
        rare_pct=RARE_PCT,
        status_reports=counts["status_reports"],
        doors_reports=counts["doors_reports"],
        enough_status=counts["status_all"] >= MIN_REPORTS,
        enough_doors=counts["doors_all"] >= MIN_REPORTS,
        reports=found,
    )
