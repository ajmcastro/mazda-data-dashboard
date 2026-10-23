from datetime import datetime

import duckdb
import pytest

from mazda_dash.ingest import ingest
from mazda_dash.model import build_model
from mazda_dash.model.lookups import load_lookups


def q(con, sql):
    return con.execute(sql).fetchall()


@pytest.fixture
def config(tmp_path):
    d = tmp_path / "codes"
    d.mkdir()
    (d / "warnings.yaml").write_text(
        '"$182":\n  title: Test warning\n  severity: warning\n"$210": {title: null}\n'
    )
    (d / "dtcs.yaml").write_text('"C1681": {title: Test DTC, severity: info}\n')
    (d / "ecus.yaml").write_text("BCM: {title: Body control module}\n")
    (d / "failure_types.yaml").write_text('"13": Circuit open\n')
    return d


@pytest.fixture
def con(data_dir, config, tmp_path):
    db = tmp_path / "m.duckdb"
    ingest(data_dir, db, config)
    con = duckdb.connect(str(db))
    yield con
    con.close()


def test_lookup_validation(tmp_path):
    con = duckdb.connect()
    (tmp_path / "warnings.yaml").write_text('"$1": {severity: bogus}\n')
    with pytest.raises(ValueError, match="severity"):
        load_lookups(con, tmp_path)
    (tmp_path / "warnings.yaml").write_text('"$1": {titel: typo}\n')
    with pytest.raises(ValueError, match="unknown field"):
        load_lookups(con, tmp_path)


def test_missing_config_files_are_fine(data_dir, tmp_path):
    db = tmp_path / "e.duckdb"
    ingest(data_dir, db, tmp_path / "does-not-exist")
    con = duckdb.connect(str(db))
    assert q(con, "SELECT count(*) FROM v_warnings WHERE NOT known") == [(4,)]


def test_warning_lookup_and_unknown_fallback(con):
    rows = {
        r[0]: r[1:]
        for r in q(
            con, "SELECT code, title, severity, known FROM v_warnings ORDER BY code"
        )
    }
    assert rows["$182"] == ("Test warning", "warning", True)
    assert rows["$21D"] == ("Unknown warning $21D", "unknown", False)
    assert rows["$210"][2] is False  # listed but without a title is still unmapped
    unmapped = q(
        con, "SELECT kind, code FROM v_unmapped_codes WHERE kind = 'warning' ORDER BY 2"
    )
    assert ("warning", "$210") in unmapped


def test_warning_frequency(con):
    row = q(
        con, "SELECT events, pct_of_events FROM v_warning_frequency WHERE code = '$210'"
    )
    assert row == [(2, 100.0)]


def test_dtc_events_decode(con):
    rows = q(
        con,
        "SELECT ecu, dtc_code, title, ecu_title, failure_type_title, system, scope, "
        "confirmed, pending, test_failed, event_at FROM v_dtc_events",
    )
    # only well-formed DTCs: 'none' and 'read_error' rows are excluded
    assert rows == [
        (
            "ADU",
            "C1681",
            "Test DTC",
            None,
            "Circuit open",
            "Chassis",
            "other",
            True,
            False,
            False,
            datetime(2026, 6, 13, 8, 45, 48),
        )
    ]
    assert q(
        con, "SELECT faults, read_errors, ecus_reported FROM v_dtc_readout_summary"
    ) == [(1, 1, 3)]
    assert q(con, "SELECT active_in_latest_readout FROM v_dtc_frequency") == [(True,)]


def test_vehicle_status_drops_invalid(con):
    row = q(con, "SELECT odometer_km, engine_state FROM v_vehicle_status")
    assert row == [(59.1, None)]  # enginestate was flagged Invalid in the fixture


def test_odometer_sources_merge(con):
    rows = q(con, "SELECT source, odometer_km FROM v_odometer_readings ORDER BY source")
    assert ("warning", 59.0) in rows and ("status", 59.1) in rows
    # 06-12 (status), 06-13 (warning/dtc) and 10-15 (diagnostic report)
    assert q(con, "SELECT count(*) FROM v_odometer_daily") == [(3,)]


def test_trip_segments_and_monthly_fuel(con):
    # trip counter: 0 -> 100 km @6.0 -> 150 km @6.4 -> reset, 20 km @7.0
    series = [
        ("2026-07-01 08:00:00", 1000.0, 0.0, 102.2),
        ("2026-07-01 09:00:00", 1100.0, 100.0, 6.0),
        ("2026-07-01 10:00:00", 1150.0, 150.0, 6.4),
        ("2026-07-02 10:00:00", 1170.0, 20.0, 7.0),
    ]
    for ts, odo, trip, l100 in series:
        for signal, value in (
            ("ododispvalue", odo),
            ("drv1distnc", trip),
            ("drv1avlfuelg", l100),
            ("drv1drvtm", trip * 60),
        ):
            con.execute(
                "INSERT INTO signal_readings VALUES ('rts', 'V', NULL, ?, NULL, ?, ?, ?, TRUE)",
                [ts, signal, str(value), value],
            )
    segs = q(
        con,
        "SELECT km, round(fuel_l, 3), after_reset, odometer_delta_km FROM v_trip_segments "
        "WHERE start_at >= '2026-07-01' ORDER BY start_at",
    )
    assert segs == [
        (100.0, 6.0, False, 100.0),
        (50.0, 3.6, False, 50.0),
        (20.0, 1.4, True, 20.0),
    ]
    month = q(
        con,
        "SELECT km, fuel_l, l_per_100km FROM v_fuel_monthly WHERE month = '2026-07'",
    )
    assert month == [(170.0, 11.0, 6.47)]
    assert q(
        con,
        "SELECT trip_l_per_100km FROM v_trip_log WHERE trip_km = 0 AND created_at >= '2026-07-01'",
    ) == [(None,)]


def test_build_model_is_repeatable(con, config):
    build_model(con, config)
    build_model(con, config)
    assert q(con, "SELECT count(*) FROM ref_warning_codes") == [(2,)]
