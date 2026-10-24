"""Read-only JSON API over the DuckDB model views.

Endpoints that describe a period take optional ``from`` / ``to`` days (see ``dates.py``).
Endpoints that describe a *state* (active faults, alerts, the diagnostic-tool report, the
description lookups) deliberately ignore them."""

from datetime import timedelta
from typing import Literal

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Query

from . import models as m
from .dates import DateRange, date_range
from .db import db_path, get_con, get_rw_con, has_table, one, rows
from .trends import monthly_metrics

app = FastAPI(title="Mazda CX-5 dashboard API", version="0.2.0")
Con = Depends(get_con)
RwCon = Depends(get_rw_con)
Range = Depends(date_range)


@app.get("/api/health", response_model=m.Health)
def health():
    path = db_path()
    return m.Health(status="ok", database=str(path), has_data=path.exists())


@app.get("/api/span", response_model=m.DataSpan)
def data_span(con: duckdb.DuckDBPyConnection = Con):
    """First and last day with any data, used to bound the date pickers."""
    span = one(
        con,
        "SELECT CAST(min(read_at) AS DATE) AS first_day, CAST(max(read_at) AS DATE) AS last_day "
        "FROM v_odometer_readings",
    )
    return m.DataSpan(**span)


@app.get("/api/overview", response_model=m.Overview)
def overview(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    odo_where, odo_params = rng.clause("read_at")
    odo = one(
        con,
        f"SELECT read_at, odometer_km FROM v_odometer_readings {odo_where} "
        "ORDER BY odometer_km DESC, read_at DESC LIMIT 1",
        odo_params,
    )
    span = one(
        con, "SELECT min(read_at) AS a, max(read_at) AS b FROM v_odometer_readings"
    )

    # Distance driven in the range: odometer at its end minus the last reading before its
    # start (or the first reading inside it when the range starts before any data).
    km = None
    if odo:
        base = (
            one(
                con,
                "SELECT max(odometer_km) AS v FROM v_odometer_readings WHERE read_at < ?",
                [rng.start_ts],
            ).get("v")
            if rng.start_ts
            else None
        )
        if base is None:
            base = one(
                con,
                f"SELECT min(odometer_km) AS v FROM v_odometer_readings {odo_where}",
                odo_params,
            )["v"]
        km = odo["odometer_km"] - base

    st_where, st_params = rng.clause("created_at", "AND")
    status = one(
        con,
        "SELECT created_at AS at, fuel_level_pct, range_km, tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, "
        f"tire_rr_kpa FROM v_vehicle_status WHERE fuel_level_pct IS NOT NULL {st_where} "
        "ORDER BY created_at DESC LIMIT 1",
        st_params,
    )
    diag = one(
        con,
        "SELECT lifetime_l_per_100km FROM v_diag_summary ORDER BY taken_at DESC LIMIT 1",
    )
    seg_where, seg_params = rng.clause("end_at")
    economy = one(
        con,
        f"SELECT 100 * sum(fuel_l) / nullif(sum(km), 0) AS v FROM v_trip_segments {seg_where}",
        seg_params,
    )
    w_where, w_params = rng.clause("triggered_at")
    warnings = one(
        con,
        "SELECT (SELECT count(*) FROM warning_events) AS total, "
        f"(SELECT count(*) FROM warning_events {w_where}) AS in_range",
        w_params,
    )
    ev_where, ev_params = rng.clause("event_at")
    faults_seen = one(
        con,
        "SELECT count(*) AS n FROM (SELECT DISTINCT ecu, dtc_code, failure_type "
        f"FROM v_dtc_events {ev_where})",
        ev_params,
    )["n"]
    active = one(
        con,
        "SELECT count(*) FILTER (WHERE active_in_latest_readout) AS n FROM v_dtc_frequency",
    )["n"]
    al_where, al_params = rng.clause("created_at", "AND")
    alarm = one(
        con,
        "SELECT created_at, burglar_status, alarm_reason FROM v_alarm_events "
        f"WHERE (burglar_status > 1 OR alarm_reason > 0) {al_where} ORDER BY created_at DESC LIMIT 1",
        al_params,
    )
    first_day = span["a"].date() if span.get("a") else None
    last_day = span["b"].date() if span.get("b") else None
    return m.Overview(
        vin=one(con, "SELECT vin FROM warning_events LIMIT 1").get("vin"),
        odometer_km=odo.get("odometer_km"),
        odometer_at=odo.get("read_at"),
        data_from=span.get("a"),
        data_to=span.get("b"),
        range_from=rng.start or first_day,
        range_to=rng.end or last_day,
        has_data_in_range=bool(odo),
        km_in_range=km,
        lifetime_l_per_100km=diag.get("lifetime_l_per_100km"),
        l_per_100km_in_range=economy["v"],
        status=m.LatestStatus(**status),
        warnings_total=warnings["total"],
        warnings_in_range=warnings["in_range"],
        active_faults=active or 0,
        faults_seen=faults_seen,
        unmapped_codes=one(con, "SELECT count(*) AS n FROM v_unmapped_codes")["n"],
        alerts_new=(
            one(con, "SELECT count(*) AS n FROM alerts WHERE status = 'new'")["n"]
            if has_table(con, "alerts")
            else 0
        ),
        last_alarm=m.AlarmEvent(**alarm) if alarm else None,
    )


@app.get("/api/trends/monthly", response_model=list[m.MonthMetrics])
def trends_monthly(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    """One row per calendar month in the period, for the month-by-month comparison page."""
    return monthly_metrics(con, rng)


@app.get("/api/odometer/daily", response_model=list[m.OdometerDay])
def odometer_daily(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    where, params = rng.clause("day")
    return rows(con, f"SELECT * FROM v_odometer_daily {where} ORDER BY day", params)


@app.get("/api/fuel/monthly", response_model=list[m.FuelMonth])
def fuel_monthly(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    # same aggregates as the v_fuel_monthly view, over the segments inside the range
    where, params = rng.clause("end_at")
    return rows(
        con,
        "SELECT strftime(date_trunc('month', end_at), '%Y-%m') AS month, count(*) AS segments, "
        "round(sum(km), 1) AS km, round(sum(fuel_l), 1) AS fuel_l, "
        "round(100 * sum(fuel_l) / nullif(sum(km), 0), 2) AS l_per_100km, "
        "round(sum(driving_seconds) / 3600.0, 1) AS driving_hours, "
        "round(sum(km) / nullif(sum(driving_seconds) / 3600.0, 0), 1) AS avg_speed_kmh "
        f"FROM v_trip_segments {where} GROUP BY 1 ORDER BY month",
        params,
    )


@app.get("/api/trips/segments", response_model=list[m.TripSegment])
def trip_segments(
    limit: int = Query(500, ge=1, le=5000),
    rng: DateRange = Range,
    con: duckdb.DuckDBPyConnection = Con,
):
    where, params = rng.clause("end_at")
    return rows(
        con,
        f"SELECT * FROM v_trip_segments {where} ORDER BY end_at DESC LIMIT ?",
        [*params, limit],
    )


@app.get("/api/status/timeline", response_model=list[m.StatusPoint])
def status_timeline(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    where, params = rng.clause("created_at")
    return rows(
        con,
        "SELECT created_at, odometer_km, fuel_level_pct, range_km, trip_km, engine_state, "
        "tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa "
        f"FROM v_vehicle_status {where} ORDER BY created_at",
        params,
    )


@app.get("/api/doors/timeline", response_model=list[m.DoorPoint])
def doors_timeline(
    limit: int = Query(200, ge=1, le=5000),
    rng: DateRange = Range,
    con: duckdb.DuckDBPyConnection = Con,
):
    where, params = rng.clause("created_at")
    return rows(
        con,
        f"SELECT * FROM v_door_status {where} ORDER BY created_at DESC LIMIT ?",
        [*params, limit],
    )


@app.get("/api/alarms", response_model=list[m.AlarmEvent])
def alarms(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    where, params = rng.clause("created_at")
    return rows(
        con, f"SELECT * FROM v_alarm_events {where} ORDER BY created_at DESC", params
    )


@app.get("/api/warnings/frequency", response_model=list[m.WarningFrequency])
def warning_frequency(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    # same aggregates as v_warning_frequency; the share is relative to the events in range
    where, params = rng.clause("triggered_at")
    return rows(
        con,
        "SELECT code, any_value(title) AS title, any_value(severity) AS severity, "
        "bool_or(known) AS known, count(*) AS events, "
        f"round(100.0 * count(*) / (SELECT count(*) FROM warning_events {where}), 1) AS pct_of_events, "
        "count(DISTINCT CAST(triggered_at AS DATE)) AS days_seen, "
        "min(triggered_at) AS first_seen, max(triggered_at) AS last_seen "
        f"FROM v_warnings {where} GROUP BY code ORDER BY events DESC, code",
        [*params, *params],
    )


@app.get("/api/warnings/daily", response_model=list[m.WarningDay])
def warning_daily(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    where, params = rng.clause("triggered_at", "AND")
    return rows(
        con,
        "SELECT CAST(triggered_at AS DATE) AS day, code, count(*) AS events FROM v_warnings "
        f"WHERE triggered_at IS NOT NULL {where} GROUP BY 1, 2 ORDER BY 1, 2",
        params,
    )


@app.get("/api/warnings/events", response_model=m.WarningPage)
def warning_events(
    code: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    rng: DateRange = Range,
    con: duckdb.DuckDBPyConnection = Con,
):
    conds, params = rng.conds("triggered_at")
    if code:
        conds.append("code = ?")
        params.append(code)
    where = "WHERE " + " AND ".join(conds) if conds else ""
    total = one(con, f"SELECT count(*) AS n FROM v_warnings {where}", params)["n"]
    items = rows(
        con,
        "SELECT transaction_id, triggered_at, odometer_km, code, title, severity, known "
        f"FROM v_warnings {where} ORDER BY triggered_at DESC NULLS LAST LIMIT ? OFFSET ?",
        [*params, limit, offset],
    )
    return m.WarningPage(total=total, items=items)


@app.get("/api/dtcs/frequency", response_model=list[m.DtcFrequency])
def dtc_frequency(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    """Per fault: read-outs and first/last seen *within the range*. Faults still active in the
    latest read-out are always listed (that is a state), with all-time dates if they were not
    reported inside the range."""
    where, params = rng.clause("event_at")
    return rows(
        con,
        f"""WITH everything AS (
                SELECT ecu, dtc_code, failure_type, any_value(ecu_title) AS ecu_title,
                       any_value(title) AS title, any_value(severity) AS severity,
                       min(event_at) AS first_seen, max(event_at) AS last_seen,
                       min(odometer_km) AS first_odometer_km, max(odometer_km) AS last_odometer_km,
                       bool_or(transaction_id = (SELECT transaction_id FROM dtc_headers
                                                 ORDER BY copied_at DESC LIMIT 1)) AS active
                FROM v_dtc_events GROUP BY ecu, dtc_code, failure_type),
            inside AS (
                SELECT ecu, dtc_code, failure_type, count(DISTINCT transaction_id) AS readouts,
                       min(event_at) AS first_seen, max(event_at) AS last_seen,
                       min(odometer_km) AS first_odometer_km, max(odometer_km) AS last_odometer_km
                FROM v_dtc_events {where} GROUP BY ecu, dtc_code, failure_type)
            SELECT e.ecu, e.ecu_title, e.dtc_code, e.failure_type, e.title, e.severity,
                   coalesce(i.readouts, 0) AS readouts,
                   coalesce(i.first_seen, e.first_seen) AS first_seen,
                   coalesce(i.last_seen, e.last_seen) AS last_seen,
                   coalesce(i.first_odometer_km, e.first_odometer_km) AS first_odometer_km,
                   coalesce(i.last_odometer_km, e.last_odometer_km) AS last_odometer_km,
                   e.active AS active_in_latest_readout
            FROM everything e LEFT JOIN inside i USING (ecu, dtc_code, failure_type)
            WHERE i.readouts > 0 OR e.active
            ORDER BY e.active DESC, last_seen DESC, e.ecu, e.dtc_code, e.failure_type""",
        params,
    )


@app.get("/api/dtcs/events", response_model=list[m.DtcEvent])
def dtc_events(
    ecu: str | None = None,
    dtc_code: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
    rng: DateRange = Range,
    con: duckdb.DuckDBPyConnection = Con,
):
    conds, params = rng.conds("event_at")
    for col, val in (("ecu", ecu), ("dtc_code", dtc_code)):
        if val:
            conds.append(f"{col} = ?")
            params.append(val)
    where = "WHERE " + " AND ".join(conds) if conds else ""
    return rows(
        con,
        "SELECT transaction_id, event_at, odometer_km, ecu, dtc_code, failure_type, title, severity, "
        "failure_type_title, system, confirmed, pending, test_failed, warning_indicator "
        f"FROM v_dtc_events {where} ORDER BY event_at DESC, ecu, dtc_code LIMIT ?",
        [*params, limit],
    )


@app.get("/api/dtcs/readouts", response_model=list[m.Readout])
def dtc_readouts(rng: DateRange = Range, con: duckdb.DuckDBPyConnection = Con):
    where, params = rng.clause("event_at")
    return rows(
        con,
        "SELECT transaction_id, event_at, odometer_km, faults, read_errors, ecus_reported "
        f"FROM v_dtc_readout_summary {where} ORDER BY event_at DESC, transaction_id",
        params,
    )


@app.get("/api/dtcs/snapshots", response_model=list[m.SnapshotSignal])
def dtc_snapshots(ecu: str, dtc_code: str, con: duckdb.DuckDBPyConnection = Con):
    return rows(
        con,
        "SELECT transaction_id, record_number, snapshot_at, odometer_km, signal, value, value_num "
        "FROM v_dtc_snapshot_signals WHERE ecu = ? AND dtc_code = ? "
        "ORDER BY snapshot_at DESC NULLS LAST, record_number, signal",
        [ecu, dtc_code],
    )


@app.get("/api/codes/unmapped", response_model=list[m.UnmappedCode])
def unmapped(con: duckdb.DuckDBPyConnection = Con):
    return rows(
        con, "SELECT * FROM v_unmapped_codes ORDER BY kind, occurrences DESC, code"
    )


ALERT_COLS = "alert_id, rule, severity, title, detail, link, occurred_at, created_at, status, acknowledged_at"


@app.get("/api/alerts", response_model=list[m.Alert])
def list_alerts(
    status: Literal["new", "acknowledged", "all"] = "new",
    con: duckdb.DuckDBPyConnection = Con,
):
    if not has_table(con, "alerts"):
        return []
    where, params = ("", []) if status == "all" else ("WHERE status = ?", [status])
    return rows(
        con,
        f"SELECT {ALERT_COLS} FROM alerts {where} "
        "ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, "
        "occurred_at DESC NULLS LAST, alert_id DESC",
        params,
    )


@app.post("/api/alerts/acknowledge-all", response_model=m.Acknowledged)
def acknowledge_all(con: duckdb.DuckDBPyConnection = RwCon):
    if not has_table(con, "alerts"):
        return m.Acknowledged(acknowledged=0)
    n = con.execute(
        "UPDATE alerts SET status = 'acknowledged', acknowledged_at = now()::TIMESTAMP "
        "WHERE status = 'new'"
    ).fetchone()[0]
    return m.Acknowledged(acknowledged=n)


@app.post("/api/alerts/{alert_id}/acknowledge", response_model=m.Alert)
def acknowledge(alert_id: int, con: duckdb.DuckDBPyConnection = RwCon):
    if has_table(con, "alerts"):
        con.execute(
            "UPDATE alerts SET status = 'acknowledged', acknowledged_at = now()::TIMESTAMP "
            "WHERE alert_id = ? AND status = 'new'",
            [alert_id],
        )
    found = (
        rows(con, f"SELECT {ALERT_COLS} FROM alerts WHERE alert_id = ?", [alert_id])
        if has_table(con, "alerts")
        else []
    )
    if not found:
        raise HTTPException(404, f"No alert with id {alert_id}")
    return found[0]


# ------------------------------------------------------------ diagnostic tool


def _report_or_404(con: duckdb.DuckDBPyConnection, report_id: str) -> dict:
    info = one(
        con,
        "SELECT r.report_id, r.source_file, r.vin, r.taken_at, r.odometer_km, "
        "(SELECT count(*) FROM diag_values v WHERE v.report_id = r.report_id) AS values, "
        "(SELECT count(*) FROM diag_dtcs d WHERE d.report_id = r.report_id) AS dtcs, "
        "(SELECT count(*) FROM diag_obd_tests t WHERE t.report_id = r.report_id) AS obd_tests "
        "FROM diag_reports r WHERE r.report_id = ?",
        [report_id],
    )
    if not info:
        raise HTTPException(404, f"No diagnostic report {report_id}")
    return info


@app.get("/api/diag/reports", response_model=list[m.DiagReportInfo])
def diag_reports(con: duckdb.DuckDBPyConnection = Con):
    return rows(
        con,
        "SELECT r.report_id, r.source_file, r.vin, r.taken_at, r.odometer_km, "
        "(SELECT count(*) FROM diag_values v WHERE v.report_id = r.report_id) AS values, "
        "(SELECT count(*) FROM diag_dtcs d WHERE d.report_id = r.report_id) AS dtcs, "
        "(SELECT count(*) FROM diag_obd_tests t WHERE t.report_id = r.report_id) AS obd_tests "
        "FROM diag_reports r ORDER BY r.taken_at DESC, r.source_file",
    )


@app.get("/api/diag/history", response_model=list[m.DiagHistoryPoint])
def diag_history(con: duckdb.DuckDBPyConnection = Con):
    """Every diagnostic-tool report with its headline numbers, oldest first."""
    return rows(
        con,
        "SELECT r.report_id, r.source_file, r.taken_at, r.odometer_km, s.lifetime_km, "
        "s.lifetime_fuel_l, s.lifetime_l_per_100km, s.engine_hours, s.ignition_cycles, "
        "(SELECT count(*) FROM v_diag_obd o WHERE o.report_id = r.report_id) AS monitors_total, "
        "(SELECT count(*) FROM v_diag_obd o WHERE o.report_id = r.report_id AND o.in_range) "
        "AS monitors_passed, "
        "(SELECT count(*) FROM diag_dtcs d WHERE d.report_id = r.report_id) AS dtcs_listed "
        "FROM diag_reports r LEFT JOIN v_diag_summary s USING (report_id) "
        "ORDER BY r.taken_at, r.source_file",
    )


@app.get("/api/diag/reports/{report_id}", response_model=m.DiagReport)
def diag_report(report_id: str, con: duckdb.DuckDBPyConnection = Con):
    info = _report_or_404(con, report_id)
    summary = one(
        con,
        "SELECT lifetime_km, lifetime_fuel_l, lifetime_l_per_100km, recent_km, recent_fuel_l, "
        "recent_l_per_100km, engine_hours, ignition_cycles FROM v_diag_summary WHERE report_id = ?",
        [report_id],
    )
    sections: dict[tuple, list[dict]] = {}
    for r in rows(
        con,
        "SELECT ecu, section, seq, key, value, value_num, unit FROM diag_values "
        "WHERE report_id = ? AND section IS DISTINCT FROM 'AES ID and Status' ORDER BY rowid",
        [report_id],
    ):
        label = r["key"] if r["seq"] == 1 else f"{r['key']} #{r['seq']}"
        sections.setdefault((r["ecu"], r["section"] or "General"), []).append(
            {
                "key": label,
                "value": r["value"],
                "value_num": r["value_num"],
                "unit": r["unit"],
            }
        )
    groups: dict[tuple, list[dict]] = {}
    for r in rows(
        con,
        "SELECT d.list_name, d.ecu, d.dtc_code, d.failure_type, d.status_byte, c.title "
        "FROM diag_dtcs d LEFT JOIN ref_dtc_codes c ON c.dtc_code = d.dtc_code "
        "WHERE d.report_id = ? ORDER BY d.rowid",
        [report_id],
    ):
        groups.setdefault((r["list_name"], r["ecu"]), []).append(
            {k: r[k] for k in ("dtc_code", "failure_type", "status_byte", "title")}
        )
    return m.DiagReport(
        info=info,
        summary=m.DiagSummary(**summary),
        sections=[
            m.DiagSection(ecu=ecu, name=name, items=items)
            for (ecu, name), items in sections.items()
        ],
        dtc_lists=[
            m.DiagDtcGroup(list_name=lst, ecu=ecu, dtcs=dtcs)
            for (lst, ecu), dtcs in groups.items()
        ],
        obd_tests=rows(
            con,
            "SELECT ecu, obdmid, test, min_value, max_value, value, unit, in_range, position "
            "FROM v_diag_obd WHERE report_id = ? ORDER BY ecu, obdmid, test",
            [report_id],
        ),
        aes=rows(
            con,
            "SELECT aes_id, state FROM v_diag_aes WHERE report_id = ? ORDER BY seq",
            [report_id],
        ),
    )


@app.get("/api/diag/reports/{report_id}/frames", response_model=list[m.DiagFrame])
def diag_report_frames(report_id: str, con: duckdb.DuckDBPyConnection = Con):
    _report_or_404(con, report_id)
    frames: dict[tuple, dict] = {}
    for r in rows(
        con,
        "SELECT ecu, dtc_code, failure_type, status_byte, record_number, signal, value, value_num, unit "
        "FROM diag_snapshots WHERE report_id = ? ORDER BY rowid",
        [report_id],
    ):
        key = (r["ecu"], r["dtc_code"], r["failure_type"], r["record_number"])
        frame = frames.setdefault(
            key,
            {
                "ecu": r["ecu"],
                "dtc_code": r["dtc_code"],
                "failure_type": r["failure_type"],
                "status_byte": r["status_byte"],
                "record_number": r["record_number"],
                "signals": [],
            },
        )
        frame["signals"].append(
            {
                "key": r["signal"],
                "value": r["value"],
                "value_num": r["value_num"],
                "unit": r["unit"],
            }
        )
    return list(frames.values())


@app.get("/api/diag/compare", response_model=list[m.DiagDelta])
def diag_compare(a: str, b: str, con: duckdb.DuckDBPyConnection = Con):
    """Numeric values present in both reports, with the change from ``a`` to ``b``."""
    _report_or_404(con, a)
    _report_or_404(con, b)
    return rows(
        con,
        "SELECT x.ecu, x.section, CASE WHEN x.seq = 1 THEN x.key ELSE x.key || ' #' || x.seq END AS key, "
        "coalesce(y.unit, x.unit) AS unit, x.value_num AS a, y.value_num AS b, "
        "y.value_num - x.value_num AS delta "
        "FROM diag_values x JOIN diag_values y ON x.ecu IS NOT DISTINCT FROM y.ecu "
        "AND x.section IS NOT DISTINCT FROM y.section AND x.key = y.key AND x.seq = y.seq "
        "WHERE x.report_id = ? AND y.report_id = ? "
        "AND x.value_num IS NOT NULL AND y.value_num IS NOT NULL ORDER BY x.rowid",
        [a, b],
    )


# --------------------------------------------------------------- freeze frames


@app.get("/api/dtcs/frames", response_model=list[m.FreezeFrame])
def freeze_frames(ecu: str, dtc_code: str, con: duckdb.DuckDBPyConnection = Con):
    """Distinct freeze frames of a DTC, newest first, each with its signals."""
    frames = rows(
        con,
        "SELECT ecu, dtc_code, record_number, snapshot_at, first_reported_at, last_reported_at, "
        "times_reported, odometer_km FROM v_freeze_frames WHERE ecu = ? AND dtc_code = ? "
        "ORDER BY snapshot_at DESC NULLS LAST, record_number",
        [ecu, dtc_code],
    )
    signals: dict[tuple, dict[str, dict]] = {}
    for r in rows(
        con,
        "SELECT record_number, snapshot_at, signal, value, value_num FROM v_dtc_snapshot_signals "
        "WHERE ecu = ? AND dtc_code = ? ORDER BY signal",
        [ecu, dtc_code],
    ):
        # the same frame repeats across read-outs with identical values; keep one copy
        signals.setdefault((r["record_number"], r["snapshot_at"]), {}).setdefault(
            r["signal"],
            {"signal": r["signal"], "value": r["value"], "value_num": r["value_num"]},
        )
    return [
        m.FreezeFrame(
            frame_id=f"{f['record_number']}@{f['snapshot_at']:%Y%m%dT%H%M%S}"
            if f["snapshot_at"]
            else f"{f['record_number']}@unknown",
            record_number=f["record_number"],
            snapshot_at=f["snapshot_at"],
            first_reported_at=f["first_reported_at"],
            last_reported_at=f["last_reported_at"],
            times_reported=f["times_reported"],
            odometer_km=f["odometer_km"],
            signals=list(
                signals.get((f["record_number"], f["snapshot_at"]), {}).values()
            ),
        )
        for f in frames
    ]


@app.get("/api/dtcs/context", response_model=m.FaultContext)
def fault_context(
    transaction_id: str,
    window_hours: float = Query(2, gt=0, le=48),
    con: duckdb.DuckDBPyConnection = Con,
):
    """What else was going on around a fault read-out: nearby warnings, the other faults in
    the same read-out and the closest vehicle-status snapshot."""
    head = one(
        con,
        "SELECT coalesce(triggered_at, copied_at) AS event_at, odometer_km FROM dtc_headers "
        "WHERE transaction_id = ?",
        [transaction_id],
    )
    if not head:
        raise HTTPException(404, f"No read-out {transaction_id}")
    at = head["event_at"].replace(tzinfo=None)
    margin = timedelta(hours=window_hours)
    warnings = rows(
        con,
        "SELECT triggered_at, code, title, severity FROM v_warnings "
        "WHERE triggered_at BETWEEN ? AND ? ORDER BY triggered_at",
        [at - margin, at + margin],
    )
    others = rows(
        con,
        "SELECT ecu, dtc_code, failure_type, title FROM v_dtc_events WHERE transaction_id = ? "
        "ORDER BY ecu, dtc_code",
        [transaction_id],
    )
    status = one(
        con,
        "SELECT created_at, odometer_km, fuel_level_pct, range_km, trip_km, engine_state, tire_fl_kpa, "
        "tire_fr_kpa, tire_rl_kpa, tire_rr_kpa, "
        "abs(date_diff('second', created_at, ?)) / 60.0 AS offset_minutes FROM v_vehicle_status "
        "WHERE abs(date_diff('second', created_at, ?)) <= 3 * 3600 "
        "ORDER BY abs(date_diff('second', created_at, ?)) LIMIT 1",
        [at, at, at],
    )
    offset = status.pop("offset_minutes", None)
    return m.FaultContext(
        event_at=head["event_at"],
        odometer_km=head["odometer_km"],
        window_hours=window_hours,
        warnings=warnings,
        other_faults=others,
        status=m.StatusPoint(**status) if status else None,
        status_offset_minutes=offset,
    )
