"""The car's own warning flags: views, API, alert rule (M18)."""

import os
import re
from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from mazda_dash.alerts import evaluate
from mazda_dash.alerts.config import CAR_WARNING_FLAGS, AlertsConfig
from mazda_dash.alerts.engine import run_alerts
from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.pack import used_signals, views_sql
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config"
T0 = datetime(2026, 5, 1, 8, 0)
FLAG = "rltyrepresswarn"


def add(con, flag, values, start=T0, step=timedelta(days=1), source="rts"):
    """Insert readings of a flag; None = an Invalid reading. Returns the times."""
    times = []
    for i, v in enumerate(values):
        t = start + i * step
        times.append(t)
        con.execute(
            "INSERT INTO signal_readings VALUES (?, 'V', 'x', ?, NULL, ?, ?, ?, ?)",
            [source, t, flag, None if v is None else str(v), v, v is not None],
        )
    return times


@pytest.fixture
def con(data_dir, tmp_path):
    db = tmp_path / "w.duckdb"
    codes = tmp_path / "codes"
    codes.mkdir()
    ingest(data_dir, db, codes)
    con = duckdb.connect(str(db))
    yield con
    con.close()


def cfg(**rule):
    return AlertsConfig.model_validate(
        {"lookback_days": 400, "rules": {"car_warning_flag": rule} if rule else {}}
    )


def flag_alerts(created):
    return [c for c in created if c.rule == "car_warning_flag"]


# --------------------------------------------------------------- views


def test_runs_are_found_and_invalid_readings_are_ignored(con):
    t = add(
        con, FLAG, [0, 1, 1, None, 0, 2, 0, 3]
    )  # the Invalid reading sits inside a run's gap
    rows = con.execute(
        "SELECT started_at, last_on_at, readings, max_value, ongoing FROM v_car_warning_episodes "
        "ORDER BY started_at"
    ).fetchall()
    assert rows == [
        (t[1], t[2], 2, 1.0, False),
        (t[5], t[5], 1, 2.0, False),  # any non-zero value counts, the raw value is kept
        (
            t[7],
            t[7],
            1,
            3.0,
            True,
        ),  # the run that includes the latest reading is ongoing
    ]


def test_all_clear_has_no_episodes_and_labels_exist(con):
    add(con, FLAG, [0, 0, 0])
    assert con.execute("SELECT count(*) FROM v_car_warning_episodes").fetchone()[0] == 0
    assert con.execute(
        "SELECT DISTINCT label, sort_order FROM v_car_warning_readings"
    ).fetchall() == [("tire pressure, rear left", 3)]


def test_every_flag_in_the_alert_config_is_in_the_view_and_the_pack():
    """The three lists (view, alert config, phone pack signals) must not drift apart."""
    block = (
        views_sql()
        .split("CREATE OR REPLACE VIEW v_car_warning_readings")[1]
        .split(";")[0]
    )
    in_view = tuple(re.findall(r"signal = '([a-z0-9_]+)'", block))
    assert in_view == CAR_WARNING_FLAGS
    assert set(CAR_WARNING_FLAGS) <= set(used_signals())


# --------------------------------------------------------------- alert rule


def test_one_alert_per_run_and_no_repeat(con):
    add(con, FLAG, [0, 1, 1, 1])
    first = flag_alerts(run_alerts(con, cfg()))
    assert len(first) == 1
    assert first[0].title == "The car reports a warning: tire pressure, rear left"
    assert first[0].link == "/status" and first[0].severity == "warning"
    assert "since" in first[0].detail and "raw value 1" in first[0].detail
    assert flag_alerts(run_alerts(con, cfg())) == []
    add(con, FLAG, [1, 1], start=T0 + timedelta(days=10))  # the same run goes on
    assert flag_alerts(run_alerts(con, cfg())) == []


def test_a_new_run_after_all_clear_is_a_new_alert(con):
    add(con, FLAG, [1, 1, 0])
    assert len(flag_alerts(run_alerts(con, cfg()))) == 1
    add(con, FLAG, [0, 2], start=T0 + timedelta(days=20))
    again = flag_alerts(run_alerts(con, cfg()))
    assert (
        len(again) == 1
        and "raw value 2" in again[0].detail
        and "since" in again[0].detail
    )


def test_nothing_while_all_clear(con):
    add(con, FLAG, [0, 0, 0])
    add(con, "oillevelwarning", [0, 0])
    assert flag_alerts(run_alerts(con, cfg())) == []


def test_old_runs_are_outside_the_lookback(con):
    add(con, FLAG, [1, 1])
    narrow = AlertsConfig.model_validate(
        {"lookback_days": 5}
    )  # data is from May 2026, far older
    assert flag_alerts(run_alerts(con, narrow, now=T0 + timedelta(days=200))) == []


def test_severity_can_be_set_per_flag_and_flags_can_be_ignored(con):
    add(con, FLAG, [1])
    add(con, "oillevelwarning", [1])
    got = {
        c.dedup_key.split(":")[1]: c.severity
        for c in flag_alerts(
            run_alerts(
                con,
                cfg(severities={FLAG: "critical"}, ignore_flags=["oillevelwarning"]),
            )
        )
    }
    assert got == {FLAG: "critical"}


def test_a_misspelt_flag_name_is_an_error():
    with pytest.raises(
        ValidationError, match="unknown car warning flag 'rltyrepresswarning'"
    ):
        cfg(severities={"rltyrepresswarning": "critical"})
    with pytest.raises(ValidationError, match="unknown car warning flag"):
        cfg(ignore_flags=["nope"])


def test_the_rule_can_be_switched_off(con):
    add(con, FLAG, [1])
    assert flag_alerts(run_alerts(con, cfg(enabled=False))) == []


# --------------------------------------------------------------- API + sample data


def api(db):
    os.environ["MAZDA_DB"] = str(db)
    return TestClient(app)


def test_api_without_flags_says_so(con):
    db = Path(con.execute("PRAGMA database_list").fetchone()[2])
    con.close()
    assert api(db).get("/api/status/car-warnings").json() == {
        "has_data": False,
        "all_clear": True,
        "flags": [],
        "episodes": [],
    }


@pytest.fixture(scope="module")
def demo_db(tmp_path_factory):
    root = tmp_path_factory.mktemp("flags-sample")
    generate(root / "data")
    db = root / "demo.duckdb"
    ingest(root / "data", db, CONFIG / "codes")
    evaluate(db, CONFIG / "alerts.yaml")
    return db


def test_api_on_the_sample_data(demo_db):
    body = api(demo_db).get("/api/status/car-warnings").json()
    assert body["has_data"] is True and body["all_clear"] is False
    flags = {f["flag"]: f for f in body["flags"]}
    assert [f["flag"] for f in body["flags"]] == list(
        CAR_WARNING_FLAGS
    )  # display order
    on = [f for f in body["flags"] if f["is_on"]]
    assert [f["flag"] for f in on] == [FLAG]
    assert on[0]["since"] and on[0]["episodes"] == 1 and on[0]["value"] == 1
    assert flags["dropnwrn"]["is_on"] is False and flags["dropnwrn"]["readings"] > 50
    (episode,) = body["episodes"]
    assert (
        episode["flag"] == FLAG
        and episode["ongoing"] is True
        and episode["readings"] > 5
    )
    assert episode["started_at"].endswith("Z")


def test_the_sample_leak_raises_both_the_users_rule_and_the_cars_flag(demo_db):
    con = duckdb.connect(str(demo_db), read_only=True)
    rules = {r for (r,) in con.execute("SELECT rule FROM alerts").fetchall()}
    title = con.execute(
        "SELECT title FROM alerts WHERE rule = 'car_warning_flag'"
    ).fetchone()[0]
    con.close()
    assert {"low_tire_pressure", "car_warning_flag"} <= rules
    assert title == "The car reports a warning: tire pressure, rear left"
