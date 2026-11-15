"""Tire leak forecast (PLAN.md M51): the shared SQL, GET /api/status/tire-forecast and the alert rule."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.alerts.config import AlertsConfig
from mazda_dash.alerts.engine import run_alerts
from mazda_dash.api.app import app
from mazda_dash.contract import CLOCK_SIGNALS
from mazda_dash.ingest import ingest
from mazda_dash.ingest.schema import init_schema
from mazda_dash.model import build_model
from mazda_dash.sample import PROFILES, generate
from mazda_dash.tires import MIN_READINGS

REPO = Path(__file__).parents[2]
CODES = REPO / "config" / "models" / "cx5" / "codes"
T0 = datetime(
    2026, 5, 1, 8, 0
)  # UTC; the car's zone is UTC here, so the clock reads the same
WHEELS = ("fltprsdispkp", "frtprsdispkp", "rltprsdispkp", "rrtprsdispkp")


def make_db(tmp_path, readings, alerts: str | None = None) -> Path:
    """A database with one tire measurement per entry: (days after T0, (fl, fr, rl, rr) kPa)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "settings.yaml").write_text("car_timezone: UTC\n")
    if alerts is not None:
        (tmp_path / "alerts.yaml").write_text(alerts)
    db = tmp_path / "car.duckdb"
    con = duckdb.connect(str(db))
    init_schema(con)
    for days, kpa in readings:
        at = T0 + timedelta(days=days)
        clock = (at.year, at.month, at.day, at.hour, at.minute)
        for signal, value in [
            *zip(CLOCK_SIGNALS, clock, strict=True),
            *zip(WHEELS, kpa, strict=True),
            ("ododispvalue", 1000 + 10 * days),
        ]:
            con.execute(
                "INSERT INTO signal_readings VALUES ('rts', 'TESTVIN0000000001', 'x', ?, ?, ?, ?, ?, true)",
                [at, at, signal, str(value), value],
            )
    build_model(con, CODES, tmp_path / "settings.yaml")
    con.close()
    return db


def get(db: Path):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get("/api/status/tire-forecast")
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def wheels(d) -> dict:
    return {w["wheel"]: w for w in d["wheels"]}


def steady(days: int, leak=0.0, wheel=2, start=250.0, every=1.0, swing=0.0):
    """Measurements every `every` days: all four at `start` (moving together by up to `swing`, as with the
    weather), one wheel losing `leak` kPa a day."""
    out, t, i = [], 0.0, 0
    while t <= days:
        together = swing * (1 if i % 2 else -1)
        kpa = [start + together] * 4
        kpa[wheel] = start + together - leak * t
        out.append((t, tuple(kpa)))
        t, i = t + every, i + 1
    return out


def test_a_steady_leak_gets_a_rate_and_a_date(tmp_path):
    d = get(
        make_db(tmp_path, steady(20, leak=1.0))
    )  # the rear left loses 1 kPa a day: 250 -> 230
    assert d["limit_kpa"] == 200 and d["window_days"] == 30
    w = wheels(d)
    assert [x["wheel"] for x in d["wheels"]] == ["fl", "fr", "rl", "rr"]
    rl = w["rl"]
    assert rl["enough"] and rl["losing"] and not rl["below_limit"]
    assert (
        rl["kpa_per_week"] == -7.0
        and rl["measurements"] == 21
        and rl["span_days"] == 20
    )
    assert rl["current_kpa"] == 230
    assert rl["days_left"] == 30  # 30 kPa to go at 1 kPa a day
    assert rl["reaches_limit_on"] == (T0 + timedelta(days=50)).date().isoformat()
    for other in (
        "fl",
        "fr",
        "rr",
    ):  # the others gain a third of it against the leaking one: not losing
        assert (
            w[other]["enough"]
            and not w[other]["losing"]
            and w[other]["kpa_per_week"] == pytest.approx(2.3, abs=0.1)
        )
        assert w[other]["days_left"] is None and w[other]["reaches_limit_on"] is None


def test_weather_that_moves_all_four_together_is_not_a_leak(tmp_path):
    d = get(make_db(tmp_path, steady(20, swing=12)))  # +-12 kPa on all four, day to day
    assert all(
        w["enough"] and not w["losing"] and w["kpa_per_week"] == 0 for w in d["wheels"]
    )
    # and a leak under the same swings is still found at its own rate
    leaking = wheels(get(make_db(tmp_path / "leak", steady(20, leak=1.0, swing=12))))[
        "rl"
    ]
    assert leaking["losing"] and leaking["kpa_per_week"] == -7.0


def test_one_odd_reading_does_not_move_the_rate(tmp_path):
    readings = steady(20, leak=1.0)
    day, kpa = readings[10]
    readings[10] = (
        day,
        (kpa[0], kpa[1], kpa[2] - 15, kpa[3]),
    )  # one low reading that recovers
    assert wheels(get(make_db(tmp_path, readings)))["rl"][
        "kpa_per_week"
    ] == pytest.approx(-7.0, abs=0.3)


def test_a_refill_restarts_the_series(tmp_path):
    before = steady(12, leak=2.5)  # 250 -> 220
    after = [
        (13 + t, (250.0, 250.0, 250.0 - 0.5 * t, 250.0)) for t in range(15)
    ]  # refilled, a slower leak
    rl = wheels(get(make_db(tmp_path, before + after)))["rl"]
    assert rl["refilled_at"] == (T0 + timedelta(days=13)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert rl["measurements"] == 15 and rl["span_days"] == 14
    assert rl["kpa_per_week"] == -3.5  # the rate since the refill, not the old one
    # right after a refill there is too little to go on
    fresh = wheels(get(make_db(tmp_path / "fresh", before + after[:4])))["rl"]
    assert (
        fresh["measurements"] == 4
        and not fresh["enough"]
        and fresh["kpa_per_week"] is None
        and not fresh["losing"]
    )


def test_too_little_data_gives_no_forecast(tmp_path):
    few = wheels(get(make_db(tmp_path / "few", steady(MIN_READINGS - 2, leak=3.0))))[
        "rl"
    ]  # 7 measurements
    assert (
        few["measurements"] == MIN_READINGS - 1
        and not few["enough"]
        and not few["losing"]
    )
    short = wheels(get(make_db(tmp_path / "short", steady(5, leak=3.0, every=0.25))))[
        "rl"
    ]  # many, over 5 days
    assert (
        short["measurements"] > MIN_READINGS
        and short["span_days"] == 5
        and not short["enough"]
    )
    assert get(make_db(tmp_path / "none", []))["wheels"] == []


def test_only_the_last_thirty_days_count(tmp_path):
    old_leak = steady(30, leak=1.0)  # leaked for a month ...
    flat = [
        (31 + t, (250.0, 250.0, 220.0, 250.0)) for t in range(35)
    ]  # ... then held for five weeks
    rl = wheels(get(make_db(tmp_path, old_leak + flat)))["rl"]
    assert rl["span_days"] == 30 and rl["kpa_per_week"] == 0 and not rl["losing"]


def test_a_wheel_already_under_the_limit_and_a_slow_leak(tmp_path):
    low = wheels(get(make_db(tmp_path / "low", steady(20, leak=3.0))))[
        "rl"
    ]  # 250 -> 190
    assert (
        low["losing"]
        and low["below_limit"]
        and low["days_left"] is None
        and low["reaches_limit_on"] is None
    )
    slow = wheels(get(make_db(tmp_path / "slow", steady(28, leak=0.1))))[
        "rl"
    ]  # 0.7 kPa a week: under the bar
    assert slow["enough"] and not slow["losing"] and slow["kpa_per_week"] == -0.7
    far = wheels(get(make_db(tmp_path / "far", steady(28, leak=0.2, start=300.0))))[
        "rl"
    ]  # 94 kPa at 0.2 a day
    assert (
        far["losing"] and far["days_left"] is None and far["reaches_limit_on"] is None
    )  # over a year away


def test_the_limit_is_the_models_alert_limit(tmp_path):
    alerts = "rules:\n  low_tire_pressure: {min_kpa: 220}\n"
    d = get(make_db(tmp_path, steady(20, leak=1.0), alerts=alerts))
    assert d["limit_kpa"] == 220
    assert wheels(d)["rl"]["days_left"] == 10  # 230 now, 220 the limit, 1 kPa a day


def test_the_alert_is_off_by_default_and_raised_once_per_wheel(tmp_path):
    db = make_db(tmp_path, steady(20, leak=2.0))  # 250 -> 210: five days to 200
    con = duckdb.connect(str(db))
    now = T0 + timedelta(days=21)
    assert not [
        c
        for c in run_alerts(con, AlertsConfig(), now=now)
        if c.rule == "tire_leak_forecast"
    ]
    on = AlertsConfig.model_validate(
        {"rules": {"tire_leak_forecast": {"enabled": True}}}
    )
    (alert,) = [
        c for c in run_alerts(con, on, now=now) if c.rule == "tire_leak_forecast"
    ]
    assert alert.title == "Tire losing pressure (rear left): about 5 days to the limit"
    assert (
        "14 kPa a week" in alert.detail
        and "200 kPa limit" in alert.detail
        and "21 measurements" in alert.detail
    )
    assert not [
        c for c in run_alerts(con, on, now=now) if c.rule == "tire_leak_forecast"
    ]  # once
    soon = AlertsConfig.model_validate(
        {"rules": {"tire_leak_forecast": {"enabled": True, "days": 3}}}
    )
    con2 = duckdb.connect(str(make_db(tmp_path / "later", steady(20, leak=2.0))))
    assert not [
        c for c in run_alerts(con2, soon, now=now) if c.rule == "tire_leak_forecast"
    ]  # 5 days > 3
    con.close()
    con2.close()


@pytest.mark.parametrize("pid", list(PROFILES))
def test_the_sample_cars_leaking_wheel_is_found(tmp_path, pid):
    data = tmp_path / "data"
    generate(data, profile=PROFILES[pid])
    db = tmp_path / "car.duckdb"
    ingest(data, db, REPO / "config" / "models" / pid / "codes", data / "settings.yaml")
    d = get(db)
    leaking = ("fl", "fr", "rl", "rr")[PROFILES[pid].leak_wheel]
    for w in d["wheels"]:
        assert w["enough"]
        assert w["losing"] == (w["wheel"] == leaking), w
    found = wheels(d)[leaking]
    assert (
        -25 < found["kpa_per_week"] < -8
    )  # the generator's leak is about 20 kPa a week over three weeks
    assert found["below_limit"]  # both sample cars end under 200 kPa
