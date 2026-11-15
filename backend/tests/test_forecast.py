"""Maintenance and mileage forecast (PLAN.md M52): GET /api/forecast, the mileage setting, the All cars card
and the oil alert's `days`."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.alerts.config import AlertsConfig
from mazda_dash.alerts.engine import run_alerts
from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.ingest.schema import init_schema
from mazda_dash.model import build_model
from mazda_dash.model.settings import load_settings
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
CODES = REPO / "config" / "models" / "cx5" / "codes"
T0 = datetime(2026, 1, 1, 12, 0)


def make_db(tmp_path, readings, settings="car_timezone: UTC\n") -> Path:
    """A database with one status report per entry: (days after T0, odometer km, oil countdown km or None)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "settings.yaml").write_text(settings)
    db = tmp_path / "car.duckdb"
    con = duckdb.connect(str(db))
    init_schema(con)
    for days, odometer, oil in readings:
        at = T0 + timedelta(days=days)
        for signal, value in (("ododispvalue", odometer), ("remoildistk", oil)):
            if value is not None:
                con.execute(
                    "INSERT INTO signal_readings VALUES ('rts', 'TESTVIN0000000001', 'x', ?, ?, ?, ?, ?, true)",
                    [at, at, signal, str(value), value],
                )
    build_model(con, CODES, tmp_path / "settings.yaml")
    con.close()
    return db


def get(db: Path, path="/api/forecast"):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get(path)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def daily(days: int, per_day, start=10_000.0, oil=None):
    """A report a day; `per_day` is a number or a function of the day; the countdown stays as it was read."""
    out, km = [], start
    for d in range(days + 1):
        out.append((d, km, oil))
        km += per_day(d) if callable(per_day) else per_day
    return out


def test_the_two_paces_and_the_oil_change_between_two_dates(tmp_path):
    # 20 km a day for 70 days, then 40 km a day for the last 30: the two windows give different paces
    readings = daily(100, lambda d: 20 if d < 70 else 40, oil=3000)
    d = get(make_db(tmp_path, readings))
    assert d["has_data"] and d["as_of"] == "2026-04-11"
    assert d["km_per_day_30d"] == 40 and d["km_per_day_90d"] == pytest.approx(
        (60 * 20 + 30 * 40) / 90, abs=0.05
    )
    assert d["km_per_year"] == round(d["km_per_day_90d"] * 365, -2)
    # the countdown read 3,000 km on every report, the newest included: nothing driven since
    assert d["oil_left_km"] == 3000
    assert (d["oil_days_first"], d["oil_days_last"]) == (
        75,
        113,
    )  # 3000 / 40 and 3000 / 26.67, rounded up
    assert d["oil_date_first"] == "2026-06-25" and d["oil_date_last"] == "2026-08-02"
    assert (
        d["mileage_limit_km"] is None
        and d["year_start"] is None
        and d["year_projected_km"] is None
    )


def test_what_was_driven_since_the_countdown_was_read_comes_off(tmp_path):
    readings = daily(40, 50)
    readings = [
        (d, km, 2000 if d <= 30 else None) for d, km, _ in readings
    ]  # last read 10 days and 500 km ago
    d = get(make_db(tmp_path, readings))
    assert (
        d["oil_left_km"] == 1500
        and d["oil_days_first"] == 30
        and d["oil_days_last"] == 30
    )
    assert d["km_per_day_90d"] is None  # 40 days of data: under half of 90
    assert (
        d["km_per_day_30d"] == 50 and d["km_per_year"] == 18_300
    )  # the 30-day pace stands in


def test_no_countdown_or_no_driving_gives_no_date(tmp_path):
    none = get(make_db(tmp_path / "none", daily(60, 30)))  # the car sends no countdown
    assert (
        none["oil_left_km"] is None
        and none["oil_date_first"] is None
        and none["km_per_day_30d"] == 30
    )
    parked = get(
        make_db(tmp_path / "parked", daily(60, 0.5, oil=4000))
    )  # under 1 km a day
    assert (
        parked["oil_left_km"] == 4000
        and parked["oil_date_first"] is None
        and parked["oil_days_last"] is None
    )
    far = get(
        make_db(tmp_path / "far", daily(60, 2, oil=9000))
    )  # 4,500 days: beyond two years, no date
    assert far["oil_date_first"] is None
    short = get(
        make_db(tmp_path / "short", daily(10, 50, oil=4000))
    )  # ten days: no pace at all
    assert (
        short["km_per_day_30d"] is None
        and short["km_per_year"] is None
        and short["oil_date_first"] is None
    )
    assert get(make_db(tmp_path / "empty", [])) == {"has_data": False} | {
        k: None for k in none if k != "has_data"
    }


def test_the_year_against_the_limit(tmp_path):
    settings = "car_timezone: UTC\nmileage: {limit_km_per_year: 12000, start_date: 2025-03-01}\n"
    d = get(
        make_db(tmp_path, daily(100, 40), settings)
    )  # 1 Jan to 11 Apr 2026, 4,000 km
    # the year that contains 11 April 2026 started on 1 March 2026 (the anniversary), not in 2025
    assert (d["year_start"], d["year_end"]) == ("2026-03-01", "2027-03-01")
    assert d["mileage_limit_km"] == 12000
    assert d["year_km"] == 41 * 40  # 1 March (day 59) to 11 April (day 100)
    assert d["year_counted_from"] is None
    assert (
        d["year_projected_km"] == round(1640 + 40 * 324, -2) == 14_600
    )  # 324 days to 1 March 2027
    assert d["year_over_km"] == 2600


def test_a_year_that_started_before_the_data_says_from_when_it_counts(tmp_path):
    settings = "car_timezone: UTC\nmileage: {limit_km_per_year: 20000, start_date: 2025-06-15}\n"
    d = get(
        make_db(tmp_path, daily(100, 40), settings)
    )  # the year began 15 June 2025; the data on 1 Jan 2026
    assert (d["year_start"], d["year_end"]) == ("2025-06-15", "2026-06-15")
    assert d["year_counted_from"] == "2026-01-01" and d["year_km"] == 4000
    assert d["year_over_km"] == d["year_projected_km"] - 20000 < 0
    # a start date still ahead of the data: the year has not begun
    ahead = "car_timezone: UTC\nmileage: {limit_km_per_year: 20000, start_date: 2027-01-01}\n"
    later = get(make_db(tmp_path / "ahead", daily(100, 40), ahead))
    assert (
        later["mileage_limit_km"] == 20000
        and later["year_start"] is None
        and later["year_km"] is None
    )


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("mileage: 15000\n", "must have `limit_km_per_year` and `start_date`"),
        (
            "mileage: {limit_km_per_year: 15000}\n",
            "must have `limit_km_per_year` and `start_date`",
        ),
        (
            "mileage: {limit_km_per_year: lots, start_date: 2026-03-03}\n",
            "number of kilometres",
        ),
        (
            "mileage: {limit_km_per_year: 50, start_date: 2026-03-03}\n",
            "number of kilometres",
        ),
        ("mileage: {limit_km_per_year: 15000, start_date: March}\n", "must be a date"),
        (
            "mileage: {limit_km_per_year: 15000, start_date: 2024-02-29}\n",
            "29 February",
        ),
    ],
)
def test_a_mistake_in_the_mileage_setting_fails_loudly(tmp_path, text, message):
    path = tmp_path / "settings.yaml"
    path.write_text(text)
    with pytest.raises(ValueError, match=message):
        load_settings(duckdb.connect(), path)


def test_the_setting_is_stored_for_the_views_and_the_pack(tmp_path):
    path = tmp_path / "settings.yaml"
    path.write_text("mileage: {limit_km_per_year: 15000, start_date: 2026-03-03}\n")
    values = load_settings(duckdb.connect(), path)
    assert (
        values["mileage_limit_km"] == "15000"
        and values["mileage_start"] == "2026-03-03"
    )
    assert "mileage_limit_km" not in load_settings(duckdb.connect(), None)


def test_the_all_cars_card_carries_the_oil_dates(tmp_path):
    db = make_db(tmp_path, daily(100, 40, oil=3000))
    card, ahead = get(db, "/api/garage"), get(db)
    assert (card["oil_date_first"], card["oil_date_last"]) == (
        ahead["oil_date_first"],
        ahead["oil_date_last"],
    )
    assert card["oil_date_first"] == "2026-06-25"
    bare = get(make_db(tmp_path / "bare", daily(100, 40)), "/api/garage")
    assert bare["oil_date_first"] is None and bare["oil_remaining_km"] is None


def test_the_oil_alert_can_also_fire_by_days(tmp_path):
    db = make_db(
        tmp_path, daily(100, 40, oil=3000)
    )  # 75 days at the faster pace; 3,000 km is above the limit
    con = duckdb.connect(str(db))
    now = T0 + timedelta(days=101)
    assert not [
        c
        for c in run_alerts(con, AlertsConfig(), now=now)
        if c.rule == "oil_change_due"
    ]
    far = AlertsConfig.model_validate({"rules": {"oil_change_due": {"days": 60}}})
    assert not [c for c in run_alerts(con, far, now=now) if c.rule == "oil_change_due"]
    near = AlertsConfig.model_validate({"rules": {"oil_change_due": {"days": 90}}})
    (alert,) = [c for c in run_alerts(con, near, now=now) if c.rule == "oil_change_due"]
    assert alert.title == "Oil change in about 75 days at your recent pace"
    assert (
        "between 2026-06-25 and 2026-06-25" in alert.detail
        and "3,000 km" in alert.detail
    )
    assert not [
        c for c in run_alerts(con, near, now=now) if c.rule == "oil_change_due"
    ]  # once per interval
    con.close()


@pytest.mark.parametrize("pid", list(PROFILES))
def test_the_sample_cars(tmp_path, pid):
    data = tmp_path / "data"
    generate(data, profile=PROFILES[pid])
    db = tmp_path / "car.duckdb"
    ingest(data, db, REPO / "config" / "models" / pid / "codes", data / "settings.yaml")
    d = get(db)
    assert (
        d["has_data"]
        and 20 < d["km_per_day_30d"] < 60
        and 20 < d["km_per_day_90d"] < 60
    )
    if pid == "cx5":  # sends the countdown and has a yearly limit in its demo settings
        assert d["oil_date_first"] and d["oil_date_first"] <= d["oil_date_last"]
        assert (
            d["mileage_limit_km"] == 15000
            and d["year_start"] == "2026-03-01"
            and d["year_counted_from"] is None
        )
        assert (
            d["year_projected_km"]
            and d["year_over_km"] == d["year_projected_km"] - 15000
        )
    else:  # the CX-60 sends no countdown and has no limit: only the pace
        assert d["oil_left_km"] is None and d["oil_date_first"] is None
        assert d["mileage_limit_km"] is None and d["km_per_year"] > 5000
