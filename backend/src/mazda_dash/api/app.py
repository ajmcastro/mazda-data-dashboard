"""Read-only JSON API over the DuckDB model views."""

import duckdb
from fastapi import Depends, FastAPI, Query

from . import models as m
from .db import db_path, get_con, one, rows

app = FastAPI(title="Mazda CX-5 dashboard API", version="0.1.0")
Con = Depends(get_con)


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
