"""GET /api/dtcs/frame-summary and the low_battery_frame alert (PLAN.md M36)."""

import shutil
from datetime import datetime
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.alerts.config import AlertsConfig
from mazda_dash.alerts.engine import run_alerts
from mazda_dash.api.app import FRAME_SUMMARY_SIGNALS, app
from mazda_dash.ingest import ingest
from mazda_dash.sample import generate

REPO = Path(__file__).parents[2]
CODES = REPO / "config" / "models" / "cx5" / "codes"


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    root = tmp_path_factory.mktemp("frames")
    generate(root / "data")
    path = root / "f.duckdb"
    ingest(root / "data", path, CODES)
    return path


def get(db: Path, path: str, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get(path, params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def a_fault_with_frames(db: Path):
    con = duckdb.connect(str(db), read_only=True)
    ecu, code = con.execute(
        "SELECT ecu, dtc_code FROM v_frame_signals GROUP BY 1, 2 ORDER BY count(*) DESC, 1, 2 LIMIT 1"
    ).fetchone()
    con.close()
    return ecu, code


def test_the_summary_compares_one_fault_with_all_the_others(db):
    ecu, code = a_fault_with_frames(db)
    s = get(db, "/api/dtcs/frame-summary", ecu=ecu, dtc_code=code)
    assert (s["ecu"], s["dtc_code"]) == (ecu, code)
    assert s["frames"] >= 1 and s["baseline_frames"] >= 1
    order = [n for n, _, _ in FRAME_SUMMARY_SIGNALS]
    assert [x["signal"] for x in s["signals"]] == [
        n for n in order if n in {x["signal"] for x in s["signals"]}
    ]
    for x in s["signals"]:
        assert x["min"] <= x["median"] <= x["max"]
        assert x["baseline_min"] <= x["baseline_median"] <= x["baseline_max"]
        assert x["label"] and x["position"] in (None, "low", "high")


def test_a_fault_is_not_part_of_its_own_baseline(db):
    ecu, code = a_fault_with_frames(db)
    s = get(db, "/api/dtcs/frame-summary", ecu=ecu, dtc_code=code)
    con = duckdb.connect(str(db), read_only=True)
    total = con.execute(
        "SELECT count(*) FROM (SELECT DISTINCT ecu, dtc_code, record_number, snapshot_at FROM v_frame_signals)"
    ).fetchone()[0]
    con.close()
    assert s["frames"] + s["baseline_frames"] == total


def test_a_fault_without_frames_gives_an_empty_summary_not_an_error(db):
    s = get(db, "/api/dtcs/frame-summary", ecu="NOPE", dtc_code="X0000")
    assert s["frames"] == 0 and s["signals"] == [] and s["baseline_frames"] > 0


def test_no_position_is_claimed_against_a_tiny_baseline(tmp_path):
    root = tmp_path
    generate(root / "d")
    path = root / "t.duckdb"
    ingest(root / "d", path, CODES)
    con = duckdb.connect(str(path))
    con.execute(
        "DELETE FROM dtc_snapshot_values WHERE (transaction_id, ecu, raw_dtc, record_number) NOT IN "
        "(SELECT transaction_id, ecu, raw_dtc, record_number FROM dtc_snapshot_values LIMIT 3)"
    )
    con.close()
    ecu, code = a_fault_with_frames(path)
    s = get(path, "/api/dtcs/frame-summary", ecu=ecu, dtc_code=code)
    assert s["baseline_frames"] < 10 and all(
        x["position"] is None for x in s["signals"]
    )


# ------------------------------------------------------------------ the alert


def with_frame(
    db: Path, tmp_path: Path, volts: float, at="2026-06-20 10:00:00", name="alert"
):
    """A copy of the database with one more freeze frame (fault BCM Z9999) with the given supply voltage."""
    copy = tmp_path / f"{name}-{volts}-{at[:4]}.duckdb"
    shutil.copy(db, copy)
    con = duckdb.connect(str(copy))
    con.execute(
        "INSERT INTO dtc_snapshots (transaction_id, ecu, raw_dtc, record_number, dtc_code, failure_type, "
        "copied_at, triggered_at, snapshot_at) VALUES ('tx-low', 'BCM', 'Z9999:00', '01', 'Z9999', '00', "
        f"TIMESTAMP '{at}', TIMESTAMP '{at}', TIMESTAMP '{at}')"
    )
    con.execute(
        "INSERT INTO dtc_snapshot_values (transaction_id, ecu, raw_dtc, record_number, signal, value, value_num) "
        f"VALUES ('tx-low', 'BCM', 'Z9999:00', '01', 'ECU_Power_Voltage', '{volts}', {volts})"
    )
    return con


def run(con, lookback_days=400, **rule):
    cfg = AlertsConfig.model_validate(
        {"lookback_days": lookback_days, "rules": {"low_battery_frame": rule}}
    )
    created = run_alerts(con, cfg, now=datetime(2026, 7, 5))
    return [c for c in created if c.rule == "low_battery_frame"]


def test_a_frame_below_the_limit_raises_one_alert_for_the_fault(db, tmp_path):
    con = with_frame(db, tmp_path, 11.8)
    (alert,) = run(con)
    assert alert.dedup_key == "low_battery_frame:BCM:Z9999"
    assert "11.8 V" in alert.title and "12 V limit" in alert.detail
    assert alert.severity == "warning"
    assert run(con) == []  # raised once per fault


def test_the_limit_itself_does_not_alert_and_the_limit_is_configurable(db, tmp_path):
    assert run(with_frame(db, tmp_path, 12.0)) == []
    raised = run(with_frame(db, tmp_path, 12.0, name="b"), min_voltage=12.5)
    # the sample's own frames (12.2 V and up) fall under the higher limit too
    assert "low_battery_frame:BCM:Z9999" in {c.dedup_key for c in raised}


def test_the_rule_can_be_turned_off(db, tmp_path):
    assert run(with_frame(db, tmp_path, 11.5), enabled=False) == []


def test_a_frame_older_than_the_lookback_window_is_ignored(db, tmp_path):
    old = with_frame(db, tmp_path, 11.5, at="2025-01-01 10:00:00")
    assert run(old, lookback_days=30) == []


def test_the_sample_data_never_dips_below_the_default_limit(db):
    con = duckdb.connect(str(db), read_only=True)
    low = con.execute(
        "SELECT count(*) FROM v_frame_signals WHERE signal IN ('Main_ECU_Voltage_Supply', 'ECU_Power_Voltage') "
        "AND value_num < 12.0"
    ).fetchone()[0]
    assert low == 0
