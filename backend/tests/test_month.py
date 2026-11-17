"""Next month at this pace (PLAN.md M71): the block bootstrap and GET /api/forecast/month."""

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.api.month import (
    MODULUS,
    MULTIPLIER,
    bootstrap,
    month_forecast,
    percentile,
)
from mazda_dash.ingest import ingest
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
NEWEST = date(2026, 6, 30)


def fake_db(daily_km: dict[int, float], l_per_100km=7.0, price: float | None = 1.9):
    """Stand-ins for the views the forecast reads: ``daily_km`` maps days before NEWEST to km since the report
    before (a day not listed had no report)."""
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE v_odometer_daily (day DATE, odometer_km DOUBLE, km_since_previous DOUBLE, days_since_previous BIGINT)"
    )
    con.execute(
        "CREATE TABLE v_trip_segments (start_at TIMESTAMP, end_at TIMESTAMP, km DOUBLE, fuel_l DOUBLE, gap_hours DOUBLE)"
    )
    con.execute(
        "CREATE TABLE v_fuel_prices (valid_from DATE, valid_to DATE, per_l DOUBLE)"
    )
    con.execute("CREATE TABLE ref_settings (key VARCHAR, value VARCHAR)")
    odo = 1000.0
    for back in sorted(daily_km, reverse=True):
        day = NEWEST - timedelta(days=back)
        odo += daily_km[back]
        con.execute(
            "INSERT INTO v_odometer_daily VALUES (?, ?, ?, 1)",
            [day, odo, daily_km[back]],
        )
        if daily_km[back] > 0:
            at = datetime.combine(day, datetime.min.time()) + timedelta(hours=18)
            con.execute(
                "INSERT INTO v_trip_segments VALUES (?, ?, ?, ?, 1.0)",
                [
                    at - timedelta(hours=1),
                    at,
                    daily_km[back],
                    daily_km[back] * l_per_100km / 100,
                ],
            )
    if price is not None:
        con.execute("INSERT INTO v_fuel_prices VALUES ('2026-01-01', NULL, ?)", [price])
        con.execute("INSERT INTO ref_settings VALUES ('fuel_currency', 'EUR')")
    return con


def test_the_generator_is_park_miller():
    x, seen = 1, []
    for _ in range(3):
        x = x * MULTIPLIER % MODULUS
        seen.append(x)
    assert seen == [16807, 282475249, 1622650073]


def test_a_car_driving_the_same_every_day_has_no_spread():
    got = month_forecast(fake_db({b: 20.0 for b in range(90)}))
    assert got.enough and (got.km_low, got.km_mid, got.km_high) == (600, 600, 600)
    assert (
        got.l_per_100km == pytest.approx(7.0)
        and got.litres_mid == 42
        and got.cost_mid == pytest.approx(80)
    )
    assert got.currency == "EUR" and got.as_of == NEWEST


def test_long_silences_give_a_wider_range_than_steady_driving():
    steady = month_forecast(fake_db({b: 20.0 + (b % 3) for b in range(90)}))
    lumpy = month_forecast(
        fake_db(
            {b: 210.0 for b in range(0, 90, 10)}
            | {b: 0.0 for b in range(90) if b % 10 and b % 3 == 0}
        )
    )
    assert steady.km_high - steady.km_low < 30
    assert lumpy.km_high - lumpy.km_low > 300


def test_too_few_days_with_a_report_gives_nothing():
    got = month_forecast(fake_db({b: 20.0 for b in range(0, 90, 4)}))  # 23 days
    assert not got.enough and got.days_with_data == 23 and got.km_mid is None


def test_without_a_price_there_is_no_cost():
    got = month_forecast(fake_db({b: 20.0 for b in range(90)}, price=None))
    assert got.litres_mid == 42 and got.cost_mid is None and got.currency is None


def test_the_bootstrap_is_deterministic_and_percentiles_take_no_interpolation():
    days = [float(i % 11) for i in range(90)]
    assert bootstrap(days) == bootstrap(list(days))
    assert (
        percentile([1.0, 2.0, 3.0, 4.0, 5.0], 0.5) == 3.0
        and percentile([1.0, 2.0, 3.0, 4.0], 0.9) == 3.0
    )


def test_no_data():
    got = month_forecast(fake_db({}))
    assert not got.enough and got.as_of is None


@pytest.mark.parametrize("pid", sorted(PROFILES))
def test_both_sample_cars_get_an_ordered_range(tmp_path, pid):
    data = tmp_path / pid
    generate(data, profile=PROFILES[pid])
    db = tmp_path / f"{pid}.duckdb"
    ingest(data, db, REPO / "config" / "models" / pid / "codes", data / "settings.yaml")
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        got = TestClient(app).get("/api/forecast/month").json()
    finally:
        mp.undo()
    assert got["enough"] and got["km_low"] <= got["km_mid"] <= got["km_high"]
    assert (
        got["cost_low"] <= got["cost_mid"] <= got["cost_high"]
        and got["months_of_data"] < 12
    )
