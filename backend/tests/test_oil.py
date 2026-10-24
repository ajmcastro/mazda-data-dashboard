"""The car's own oil-change countdown: view, API, alert rule (M17)."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.alerts import evaluate
from mazda_dash.alerts.config import AlertsConfig
from mazda_dash.alerts.engine import run_alerts
from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config"
T0 = datetime(2026, 5, 1, 8, 0)


def add_readings(con, values, start=T0, step=timedelta(days=2)):
    """Insert oil countdown readings; None = an Invalid reading. Returns the times used."""
    times = []
    for i, v in enumerate(values):
        t = start + i * step
        times.append(t)
        con.execute(
            "INSERT INTO signal_readings VALUES ('rts', 'V', 'x', ?, NULL, 'remoildistk', ?, ?, ?)",
            [t, None if v is None else str(v), v, v is not None],
        )
    return times


@pytest.fixture
def con(data_dir, tmp_path):
    db = tmp_path / "oil.duckdb"
    codes = tmp_path / "codes"
    codes.mkdir()
    ingest(
        data_dir, db, codes
    )  # builds the views; the fixture data has no oil readings
    con = duckdb.connect(str(db))
    yield con
    con.close()


def oil_alerts(created):
    return [c for c in created if c.rule == "oil_change_due"]


def cfg(**rule):
    return AlertsConfig.model_validate(
        {"lookback_days": 400, "rules": {"oil_change_due": rule} if rule else {}}
    )


def test_unknown_and_invalid_readings_are_dropped(con):
    add_readings(con, [9000, 65535, 9000, None, 8000, 65535])
    rows = con.execute(
        "SELECT remaining_km FROM v_oil_readings ORDER BY read_at"
    ).fetchall()
    assert [r[0] for r in rows] == [9000, 9000, 8000]


def test_a_higher_reading_starts_a_new_service_interval(con):
    times = add_readings(con, [3000, 2000, 1000, 15000, 14000])
    rows = con.execute(
        "SELECT remaining_km, interval_no, interval_started_at FROM v_oil_readings ORDER BY read_at"
    ).fetchall()
    assert [r[1] for r in rows] == [0, 0, 0, 1, 1]
    assert rows[2][2] == times[0] and rows[4][2] == times[3]


def test_no_alert_while_far_from_the_change(con):
    add_readings(con, [9000, 8000, 7000])
    assert oil_alerts(run_alerts(con, cfg())) == []


def test_alert_at_the_limit_once_per_interval_and_again_after_a_service(con):
    add_readings(con, [3000, 2000, 1000])
    first = oil_alerts(run_alerts(con, cfg()))
    assert len(first) == 1
    assert "1,000 km" in first[0].title and first[0].link == "/status"
    # running again, and a further step down in the same interval, raise nothing new
    add_readings(con, [0], start=T0 + timedelta(days=30))
    assert oil_alerts(run_alerts(con, cfg())) == []
    # the oil is changed (countdown jumps up), runs down again: a second interval, a second alert
    add_readings(con, [15000, 14000, 1000], start=T0 + timedelta(days=60))
    again = oil_alerts(run_alerts(con, cfg()))
    assert len(again) == 1 and again[0].dedup_key != first[0].dedup_key


def test_the_limit_and_severity_are_configurable(con):
    add_readings(con, [3000, 2000])
    (alert,) = oil_alerts(run_alerts(con, cfg(below_km=2000, severity="critical")))
    assert alert.severity == "critical"


def test_the_rule_can_be_switched_off(con):
    add_readings(con, [500])
    assert oil_alerts(run_alerts(con, cfg(enabled=False))) == []


# ------------------------------------------------------------- API


def api(db):
    import os

    os.environ["MAZDA_DB"] = str(db)
    return TestClient(app)


def test_api_without_oil_data_says_so(con, tmp_path):
    db = Path(con.execute("PRAGMA database_list").fetchone()[2])
    con.close()
    body = api(db).get("/api/maintenance/oil").json()
    assert body == {
        "has_data": False,
        "remaining_km": None,
        "read_at": None,
        "odometer_km": None,
        "km_since_reading": None,
        "interval_started_at": None,
        "intervals": 0,
        "steps": [],
    }


@pytest.fixture(scope="module")
def demo_db(tmp_path_factory):
    root = tmp_path_factory.mktemp("oil-sample")
    generate(root / "data")
    db = root / "demo.duckdb"
    ingest(root / "data", db, CONFIG / "codes")
    evaluate(db, CONFIG / "alerts.yaml")
    return db


def test_api_on_the_sample_data(demo_db):
    body = api(demo_db).get("/api/maintenance/oil").json()
    assert body["has_data"] is True
    assert body["remaining_km"] == 1000 and body["intervals"] == 1
    steps = body["steps"]
    assert [s["remaining_km"] for s in steps] == [5000, 4000, 3000, 2000, 1000]
    assert not any(s["serviced"] for s in steps)
    assert all(
        s["remaining_km"] != 65535 for s in steps
    )  # the unknown marker never shows
    assert body["odometer_km"] is not None and body["km_since_reading"] >= 0
    assert body["read_at"].endswith("Z")


def test_sample_data_triggers_the_oil_alert(demo_db):
    con = duckdb.connect(str(demo_db), read_only=True)
    rows = con.execute(
        "SELECT title, severity FROM alerts WHERE rule = 'oil_change_due'"
    ).fetchall()
    con.close()
    assert rows == [("Oil change due soon: about 1,000 km left", "warning")]


def test_the_oil_signal_is_in_the_phone_pack_signals():
    from mazda_dash.pack import used_signals

    assert "remoildistk" in used_signals()
