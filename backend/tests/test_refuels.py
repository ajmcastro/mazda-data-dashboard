"""Fill-ups (PLAN.md M47): the v_refuels view, the settings behind it, the fuel log and GET /api/fuel/refuels."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.ingest.schema import init_schema
from mazda_dash.model import build_model
from mazda_dash.model.settings import fuel_paid, load_settings
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
CODES = REPO / "config" / "models" / "cx5" / "codes"
T0 = datetime(2026, 5, 1, 8, 0)
SETTINGS = "car_timezone: Europe/Lisbon\nfuel_currency: EUR\nfuel_price_per_l: 2.0\ntank_litres: 50\n"


def make_db(tmp_path, readings, settings=SETTINGS, fuel_log: str | None = None) -> Path:
    """A database whose status snapshots are `readings`: (hours after T0, fuel level %, odometer km)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "settings.yaml").write_text(settings)
    if fuel_log is not None:
        (tmp_path / "fuel_log.yaml").write_text(fuel_log)
    db = tmp_path / "car.duckdb"
    con = duckdb.connect(str(db))
    init_schema(con)
    for hours, level, odometer in readings:
        at = T0 + timedelta(hours=hours)
        for signal, value in (("fuelsegementdactl", level), ("ododispvalue", odometer)):
            if value is not None:
                con.execute(
                    "INSERT INTO signal_readings VALUES ('rts', 'TESTVIN0000000001', 'x', ?, ?, ?, ?, ?, true)",
                    [at, at, signal, str(value), value],
                )
    build_model(con, CODES, tmp_path / "settings.yaml")
    con.close()
    return db


def get(db: Path, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get("/api/fuel/refuels", params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


# a tank that empties, is filled, empties again and is filled again
TWO_FILLS = [
    (0, 80, 1000), (10, 60, 1300), (20, 30, 1750),  # driving
    (22, 90, 1760),  # filled: +60 points = 30 l of a 50 l tank
    (40, 70, 2060), (60, 20, 2800),
    (61, 95, 2805),  # filled: +75 points = 37.5 l
    (80, 85, 2950),
]  # fmt: skip


def test_a_rise_of_the_level_between_two_snapshots_is_a_fill_up(tmp_path):
    got = get(make_db(tmp_path, TWO_FILLS))
    assert got["fill_ups"] == 2 and got["doubtful"] == 0
    newest, first = got["refuels"]  # newest first
    assert (first["level_before"], first["level_after"], first["points"]) == (
        30,
        90,
        60,
    )
    assert first["litres"] == 30.0 and newest["litres"] == 37.5
    assert first["before_at"] < first["after_at"] and first["gap_hours"] == 2.0
    assert first["odometer_km"] == 1760
    assert (
        got["litres"] == 67.5 and got["tank_litres"] == 50 and got["min_points"] == 15
    )


def test_the_estimated_cost_is_the_litres_times_the_price_of_that_day(tmp_path):
    dated = SETTINGS.replace(
        "fuel_price_per_l: 2.0",
        "fuel_prices:\n  - {from: 2026-01-01, per_l: 2.0}\n  - {from: 2026-05-03, per_l: 3.0}",
    )
    got = get(make_db(tmp_path, TWO_FILLS, dated))
    newest, first = got["refuels"]
    assert first["est_cost"] == 60.0  # 30 l on 2 May at 2.0
    assert newest["est_cost"] == 112.5  # 37.5 l on 3 May at 3.0
    assert got["est_cost"] == 172.5 and got["currency"] == "EUR"


def test_between_two_fill_ups_the_fuel_used_is_the_fall_of_the_gauge(tmp_path):
    newest, first = get(make_db(tmp_path, TWO_FILLS))["refuels"]
    assert first["km_since_previous"] is None and first["used_since_previous_l"] is None
    assert newest["km_since_previous"] == 1045.0  # 2805 - 1760
    assert (
        newest["used_since_previous_l"] == 35.0
    )  # from 90 down to 20 = 70 points of 50 l
    assert (
        newest["l_per_100km_since_previous"] == 3.35
    )  # whatever level each fill went to


def test_a_small_rise_is_doubtful_and_gauge_noise_is_not_listed(tmp_path):
    readings = [(0, 50, 100), (1, 53, 100), (2, 60, 110), (3, 58, 150), (4, 78, 160)]
    got = get(make_db(tmp_path, readings))
    points = sorted(r["points"] for r in got["refuels"])
    assert points == [7, 20]  # +3 is noise; +7 is listed but doubtful; +20 is a fill-up
    assert {r["points"]: r["doubtful"] for r in got["refuels"]} == {7: True, 20: False}
    assert got["fill_ups"] == 2 and got["doubtful"] == 1


def test_the_threshold_is_a_setting(tmp_path):
    readings = [(0, 50, 100), (1, 60, 110), (2, 58, 150), (3, 78, 160)]
    strict = get(
        make_db(tmp_path / "a", readings, SETTINGS + "refuel_min_points: 25\n")
    )
    assert strict["min_points"] == 25 and strict["doubtful"] == 2
    loose = get(make_db(tmp_path / "b", readings, SETTINGS + "refuel_min_points: 8\n"))
    assert loose["doubtful"] == 0


def test_a_fill_up_seen_across_a_long_silence_is_doubtful(tmp_path):
    readings = [(0, 30, 1000), (47, 90, 1400), (50, 40, 2000), (98, 95, 2300)]
    got = get(make_db(tmp_path, readings))
    by_gap = {r["gap_hours"]: r["doubtful"] for r in got["refuels"]}
    assert by_gap == {47.0: False, 48.0: True}


def test_without_the_tank_size_there_are_points_but_no_litres_or_costs(tmp_path):
    got = get(
        make_db(tmp_path, TWO_FILLS, "fuel_currency: EUR\nfuel_price_per_l: 2.0\n")
    )
    assert got["tank_litres"] is None and got["fill_ups"] == 2
    assert got["litres"] is None and got["est_cost"] is None
    for r in got["refuels"]:
        assert r["points"] > 0 and r["litres"] is None and r["est_cost"] is None
        assert (
            r["used_since_previous_l"] is None
            and r["l_per_100km_since_previous"] is None
        )


def test_without_a_price_there_are_litres_but_no_cost(tmp_path):
    got = get(make_db(tmp_path, TWO_FILLS, "tank_litres: 50\n"))
    assert got["litres"] == 67.5 and got["est_cost"] is None and got["currency"] is None


def test_a_snapshot_without_a_fuel_level_is_skipped_not_read_as_empty(tmp_path):
    readings = [(0, 40, 100), (1, None, 120), (2, 38, 140), (3, 90, 150)]
    got = get(make_db(tmp_path, readings))
    assert [r["points"] for r in got["refuels"]] == [52]


# ---- what the owner paid (fuel_log.yaml) ----


def test_a_payment_is_matched_by_its_date_and_never_mixed_into_the_estimate(tmp_path):
    log = "- {date: 2026-05-02, paid: 61.50, litres: 31.2}\n"
    got = get(make_db(tmp_path, TWO_FILLS, fuel_log=log))
    newest, first = got["refuels"]
    assert (first["paid"], first["paid_litres"], first["payments"]) == (61.5, 31.2, 1)
    assert first["est_cost"] == 60.0  # the estimate stays next to it
    assert (newest["paid"], newest["payments"]) == (None, 0)
    assert (
        got["paid"] == 61.5 and got["paid_fill_ups"] == 1 and got["est_cost"] == 135.0
    )
    assert got["unmatched"] == []


def test_two_payments_around_one_rise_are_added_up(tmp_path):
    log = (
        "- {date: 2026-05-02, paid: 30, litres: 15}\n- {date: 2026-05-02, paid: 31.5}\n"
    )
    first = get(make_db(tmp_path, TWO_FILLS, fuel_log=log))["refuels"][1]
    assert (first["paid"], first["paid_litres"], first["payments"]) == (61.5, 15.0, 2)


def test_a_payment_with_no_fill_up_around_it_is_reported_not_dropped(tmp_path):
    log = "- {date: 2026-05-02, paid: 61.50}\n- {date: 2026-05-20, paid: 40}\n"
    got = get(make_db(tmp_path, TWO_FILLS, fuel_log=log))
    assert got["unmatched"] == [{"paid_on": "2026-05-20", "paid": 40.0, "litres": None}]
    assert got["paid"] == 61.5


def test_a_fill_up_around_midnight_takes_a_payment_of_either_day(tmp_path):
    # the level rises between 23:00 on 1 May and 01:00 on 2 May (Lisbon is UTC+1 in May)
    readings = [
        (13, 20, 100),
        (15.5, 80, 110),
    ]  # 21:00 and 23:30 UTC = 22:00 and 00:30 local
    for day in ("2026-05-01", "2026-05-02"):
        got = get(
            make_db(tmp_path / day, readings, fuel_log=f"- {{date: {day}, paid: 55}}\n")
        )
        assert got["refuels"][0]["paid"] == 55.0, day
    got = get(
        make_db(tmp_path / "far", readings, fuel_log="- {date: 2026-05-03, paid: 55}\n")
    )
    assert got["refuels"][0]["paid"] is None and len(got["unmatched"]) == 1


def test_a_period_lists_its_own_fill_ups_and_keeps_the_chain_to_the_one_before(
    tmp_path,
):
    log = "- {date: 2026-05-02, paid: 61.50}\n- {date: 2026-05-20, paid: 40}\n"
    db = make_db(tmp_path, TWO_FILLS, fuel_log=log)
    got = get(db, **{"from": "2026-05-03", "to": "2026-05-10"})
    assert got["fill_ups"] == 1 and got["refuels"][0]["points"] == 75
    assert (
        got["refuels"][0]["km_since_previous"] == 1045.0
    )  # the fill-up before is outside the period
    assert (
        got["paid"] is None and got["unmatched"] == []
    )  # neither payment is in these days
    later = get(db, **{"from": "2026-05-15", "to": "2026-05-31"})
    assert later["fill_ups"] == 0 and later["unmatched"][0]["paid_on"] == "2026-05-20"


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("date: 2026-05-02\n", "expected a list"),
        ("- {date: 2026-05-02}\n", "must have `date` and `paid`"),
        ("- {date: 2026-05-02, paid: 60, liters: 30}\n", "must have `date` and `paid`"),
        ("- {date: May 2nd, paid: 60}\n", "must be a date"),
        ("- {date: 2026-05-02, paid: -5}\n", "must be a number above 0"),
        ("- {date: 2026-05-02, paid: sixty}\n", "must be a number"),
        ("- {date: 2026-05-02, paid: 60, litres: 0}\n", "must be a number above 0"),
    ],
)
def test_fuel_log_errors_name_the_file(tmp_path, text, message):
    path = tmp_path / "fuel_log.yaml"
    path.write_text(text)
    with pytest.raises(ValueError, match=message) as e:
        fuel_paid(path)
    assert "fuel_log.yaml" in str(e.value)


def test_no_fuel_log_is_an_empty_table_and_amounts_need_a_currency(tmp_path):
    (tmp_path / "settings.yaml").write_text("tank_litres: 50\n")
    con = duckdb.connect()
    load_settings(con, tmp_path / "settings.yaml")
    assert con.execute("SELECT count(*) FROM ref_fuel_paid").fetchone()[0] == 0
    (tmp_path / "fuel_log.yaml").write_text("- {date: 2026-05-02, paid: 60}\n")
    with pytest.raises(ValueError, match="amounts paid need a currency"):
        load_settings(duckdb.connect(), tmp_path / "settings.yaml")


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("tank_litres: 5\n", "tank_litres must be a number from 20 to 200"),
        ("tank_litres: big\n", "tank_litres must be a number"),
        ("refuel_min_points: 2\n", "refuel_min_points must be a number from 5 to 80"),
        ("refuel_min_points: true\n", "refuel_min_points must be a number"),
    ],
)
def test_setting_errors(tmp_path, text, message):
    (tmp_path / "settings.yaml").write_text(text)
    with pytest.raises(ValueError, match=message):
        load_settings(duckdb.connect(), tmp_path / "settings.yaml")


def test_the_threshold_has_a_default_and_the_tank_has_none(tmp_path):
    (tmp_path / "settings.yaml").write_text("car_timezone: UTC\n")
    values = load_settings(duckdb.connect(), tmp_path / "settings.yaml")
    assert values["refuel_min_points"] == "15" and "tank_litres" not in values


# ---- the synthetic cars ----


@pytest.fixture(scope="module")
def demo(tmp_path_factory):
    root = tmp_path_factory.mktemp("refuels")
    out = {}
    for pid, profile in PROFILES.items():
        data = root / pid
        generate(data, profile=profile)
        db = root / f"{pid}.duckdb"
        ingest(
            data, db, REPO / "config" / "models" / pid / "codes", data / "settings.yaml"
        )
        out[pid] = (db, profile)
    return out


@pytest.mark.parametrize("pid", list(PROFILES))
def test_the_sample_car_refuels_and_its_log_is_read(demo, pid):
    db, profile = demo[pid]
    got = get(db)
    assert (
        got["tank_litres"] == profile.tank_l
        and got["fill_ups"] >= 5
        and got["doubtful"] == 0
    )
    for r in got["refuels"]:
        assert 20 < r["litres"] <= profile.tank_l and r["est_cost"] > 0
    # two fill-ups out of three have a payment, a little above the estimate; one payment has no fill-up
    assert 0 < got["paid_fill_ups"] < got["fill_ups"]
    assert len(got["unmatched"]) == 1 and got["unmatched"][0]["paid"] == 20.0
    for r in got["refuels"]:
        if r["payments"]:
            # the receipt's litres are what really went in: more than the rise the two snapshots saw
            assert r["paid_litres"] >= r["litres"]
    chained = [r for r in got["refuels"] if r["l_per_100km_since_previous"] is not None]
    assert chained and all(3 < r["l_per_100km_since_previous"] < 15 for r in chained)
