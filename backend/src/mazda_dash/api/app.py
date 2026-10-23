"""Read-only JSON API over the DuckDB model views."""

from datetime import timedelta
from typing import Literal

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Query

from . import models as m
from .db import db_path, get_con, get_rw_con, has_table, one, rows

app = FastAPI(title="Mazda CX-5 dashboard API", version="0.1.0")
Con = Depends(get_con)
RwCon = Depends(get_rw_con)


@app.get("/api/health", response_model=m.Health)
def health():
    path = db_path()
    return m.Health(status="ok", database=str(path), has_data=path.exists())


@app.get("/api/overview", response_model=m.Overview)
def overview(con: duckdb.DuckDBPyConnection = Con):
    odo = one(
        con,
        "SELECT read_at, odometer_km FROM v_odometer_readings ORDER BY odometer_km DESC LIMIT 1",
    )
    span = one(
        con, "SELECT min(read_at) AS a, max(read_at) AS b FROM v_odometer_readings"
    )
    status = one(
        con,
        "SELECT created_at AS at, fuel_level_pct, range_km, tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, "
        "tire_rr_kpa FROM v_vehicle_status WHERE fuel_level_pct IS NOT NULL "
        "ORDER BY created_at DESC LIMIT 1",
    )
    km30 = one(
        con,
        "SELECT max(odometer_km) - (SELECT max(odometer_km) FROM v_odometer_daily "
        "WHERE day <= (SELECT max(day) FROM v_odometer_daily) - 30) AS km FROM v_odometer_daily",
    )
    diag = one(
        con,
        "SELECT lifetime_l_per_100km, recent_l_per_100km FROM v_diag_summary ORDER BY taken_at DESC LIMIT 1",
    )
    month = one(
        con, "SELECT l_per_100km FROM v_fuel_monthly ORDER BY month DESC LIMIT 1"
    )
    w = one(
        con,
        "SELECT count(*) AS total, count(*) FILTER (WHERE triggered_at >= "
        "(SELECT max(triggered_at) FROM warning_events) - INTERVAL 30 DAY) AS recent "
        "FROM warning_events",
    )
    f = one(
        con,
        "SELECT count(*) AS seen, count(*) FILTER (WHERE active_in_latest_readout) AS active "
        "FROM v_dtc_frequency",
    )
    alarm = one(
        con,
        "SELECT created_at, burglar_status, alarm_reason FROM v_alarm_events "
        "WHERE burglar_status > 1 OR alarm_reason > 0 ORDER BY created_at DESC LIMIT 1",
    )
    return m.Overview(
        vin=one(con, "SELECT vin FROM warning_events LIMIT 1").get("vin"),
        odometer_km=odo.get("odometer_km"),
        odometer_at=odo.get("read_at"),
        data_from=span.get("a"),
        data_to=span.get("b"),
        km_last_30_days=km30.get("km"),
        lifetime_l_per_100km=diag.get("lifetime_l_per_100km"),
        recent_l_per_100km=month.get("l_per_100km"),
        status=m.LatestStatus(**status),
        warnings_total=w["total"],
        warnings_last_30_days=w["recent"] or 0,
        active_faults=f["active"] or 0,
        faults_seen=f["seen"],
        unmapped_codes=one(con, "SELECT count(*) AS n FROM v_unmapped_codes")["n"],
        alerts_new=(
            one(con, "SELECT count(*) AS n FROM alerts WHERE status = 'new'")["n"]
            if has_table(con, "alerts")
            else 0
        ),
        last_alarm=m.AlarmEvent(**alarm) if alarm else None,
    )


@app.get("/api/odometer/daily", response_model=list[m.OdometerDay])
def odometer_daily(con: duckdb.DuckDBPyConnection = Con):
    return rows(con, "SELECT * FROM v_odometer_daily ORDER BY day")


@app.get("/api/fuel/monthly", response_model=list[m.FuelMonth])
def fuel_monthly(con: duckdb.DuckDBPyConnection = Con):
    return rows(con, "SELECT * FROM v_fuel_monthly ORDER BY month")


@app.get("/api/trips/segments", response_model=list[m.TripSegment])
def trip_segments(
    limit: int = Query(500, ge=1, le=5000), con: duckdb.DuckDBPyConnection = Con
):
    return rows(
        con, "SELECT * FROM v_trip_segments ORDER BY end_at DESC LIMIT ?", [limit]
    )


@app.get("/api/status/timeline", response_model=list[m.StatusPoint])
def status_timeline(con: duckdb.DuckDBPyConnection = Con):
    return rows(
        con,
        "SELECT created_at, odometer_km, fuel_level_pct, range_km, trip_km, engine_state, "
        "tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa FROM v_vehicle_status ORDER BY created_at",
    )


@app.get("/api/doors/timeline", response_model=list[m.DoorPoint])
def doors_timeline(
    limit: int = Query(200, ge=1, le=5000), con: duckdb.DuckDBPyConnection = Con
):
    return rows(
        con, "SELECT * FROM v_door_status ORDER BY created_at DESC LIMIT ?", [limit]
    )


@app.get("/api/alarms", response_model=list[m.AlarmEvent])
def alarms(con: duckdb.DuckDBPyConnection = Con):
    return rows(con, "SELECT * FROM v_alarm_events ORDER BY created_at DESC")


@app.get("/api/warnings/frequency", response_model=list[m.WarningFrequency])
def warning_frequency(con: duckdb.DuckDBPyConnection = Con):
    return rows(con, "SELECT * FROM v_warning_frequency ORDER BY events DESC")


@app.get("/api/warnings/daily", response_model=list[m.WarningDay])
def warning_daily(con: duckdb.DuckDBPyConnection = Con):
    return rows(
        con,
        "SELECT CAST(triggered_at AS DATE) AS day, code, count(*) AS events FROM v_warnings "
        "WHERE triggered_at IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2",
    )


@app.get("/api/warnings/events", response_model=m.WarningPage)
def warning_events(
    code: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    con: duckdb.DuckDBPyConnection = Con,
):
    where, params = ("WHERE code = ?", [code]) if code else ("", [])
    total = one(con, f"SELECT count(*) AS n FROM v_warnings {where}", params)["n"]
    items = rows(
        con,
        "SELECT transaction_id, triggered_at, odometer_km, code, title, severity, known "
        f"FROM v_warnings {where} ORDER BY triggered_at DESC NULLS LAST LIMIT ? OFFSET ?",
        [*params, limit, offset],
    )
    return m.WarningPage(total=total, items=items)


@app.get("/api/dtcs/frequency", response_model=list[m.DtcFrequency])
def dtc_frequency(con: duckdb.DuckDBPyConnection = Con):
    return rows(
        con,
        "SELECT * FROM v_dtc_frequency ORDER BY active_in_latest_readout DESC, last_seen DESC",
    )


@app.get("/api/dtcs/events", response_model=list[m.DtcEvent])
def dtc_events(
    ecu: str | None = None,
    dtc_code: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
    con: duckdb.DuckDBPyConnection = Con,
):
    conds, params = [], []
    for col, val in (("ecu", ecu), ("dtc_code", dtc_code)):
        if val:
            conds.append(f"{col} = ?")
            params.append(val)
    where = "WHERE " + " AND ".join(conds) if conds else ""
    return rows(
        con,
        "SELECT transaction_id, event_at, odometer_km, ecu, dtc_code, failure_type, title, severity, "
        "failure_type_title, system, confirmed, pending, test_failed, warning_indicator "
        f"FROM v_dtc_events {where} ORDER BY event_at DESC LIMIT ?",
        [*params, limit],
    )


@app.get("/api/dtcs/readouts", response_model=list[m.Readout])
def dtc_readouts(con: duckdb.DuckDBPyConnection = Con):
    return rows(
        con,
        "SELECT transaction_id, event_at, odometer_km, faults, read_errors, ecus_reported "
        "FROM v_dtc_readout_summary ORDER BY event_at DESC",
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
    return rows(con, "SELECT * FROM v_unmapped_codes ORDER BY kind, occurrences DESC")


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
        "FROM diag_reports r ORDER BY r.taken_at DESC",
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
