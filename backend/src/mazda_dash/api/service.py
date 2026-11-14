"""The service log (PLAN.md M50): what the owner noted was done to the car (``ref_service_log``, from
``config/models/<id>/service_log.yaml``) and suggestions of entries the data hints at.

A suggestion is never an entry: the oil countdown going up, or a diagnostic report, is offered with the day it
was seen, and only when the log has nothing near it (7 days: an oil change next to an oil-change entry, a
diagnostic report next to any entry). Days are the car's local days.

The GET's SQL also runs in the phone app (``mobile/src/engine/service.ts``): keep the two identical. The POST
exists only here: it edits a file of the project, which the phone cannot."""

import duckdb

from ..model.settings import SERVICE_KINDS
from . import models as m
from .db import has_table, rows

NEAR_DAYS = 7
LOG = "log AS (SELECT n, served_on, kind, note, odometer_km FROM ref_service_log), "
NO_LOG = (
    "log AS (SELECT CAST(NULL AS INTEGER) AS n, CAST(NULL AS DATE) AS served_on, CAST(NULL AS VARCHAR) AS kind, "
    "CAST(NULL AS VARCHAR) AS note, CAST(NULL AS DOUBLE) AS odometer_km WHERE false), "
)
SUGGESTED = (
    "cfg AS (SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone FROM ref_settings), "
    "sug AS (SELECT 'oil_change' AS kind, 'oil_countdown' AS reason, "
    "CAST(timezone(c.zone, make_timestamptz(epoch_us(o.read_at))) AS DATE) AS d, o.odometer_km "
    "FROM v_oil_readings o CROSS JOIN cfg c WHERE o.remaining_km > o.previous_km "
    "UNION ALL SELECT 'service', 'diagnostic_report', "
    "CAST(timezone(c.zone, make_timestamptz(epoch_us(r.taken_at))) AS DATE) AS d, max(r.odometer_km) "
    "FROM diag_reports r CROSS JOIN cfg c WHERE r.taken_at IS NOT NULL GROUP BY d) "
    "SELECT s.kind, s.reason, strftime(s.d, '%Y-%m-%d') AS date, s.odometer_km FROM sug s "
    "WHERE NOT EXISTS (SELECT 1 FROM log l WHERE abs(date_diff('day', l.served_on, s.d)) <= "
    f"{NEAR_DAYS} AND (s.kind = 'service' OR l.kind = s.kind)) ORDER BY s.d DESC, s.kind"
)


def service_log(con: duckdb.DuckDBPyConnection) -> m.ServiceLog:
    base = "WITH " + (LOG if has_table(con, "ref_service_log") else NO_LOG)
    entries = rows(
        con,
        base[:-2]
        + " SELECT strftime(served_on, '%Y-%m-%d') AS date, kind, note, odometer_km FROM log "
        "ORDER BY served_on DESC, n DESC",
    )
    suggestions = rows(con, base + SUGGESTED)
    return m.ServiceLog(
        kinds=list(SERVICE_KINDS), entries=entries, suggestions=suggestions
    )
