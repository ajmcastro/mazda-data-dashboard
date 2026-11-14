"""How the car is driven (PLAN.md M48): GET /api/trips/pattern over v_trip_segments."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.ingest.schema import init_schema
from mazda_dash.model import build_model
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
CODES = REPO / "config" / "models" / "cx5" / "codes"
T0 = datetime(2026, 5, 1, 8, 0)


def make_db(tmp_path, drives) -> Path:
    """A database with one status report at T0 and one after each drive: (hours after the report before,
    km driven, litres per 100 km of that drive). The car's trip counter runs on, never reset, and reports its
    average since it started, as the real one does."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "settings.yaml").write_text("car_timezone: Europe/Lisbon\n")
    db = tmp_path / "car.duckdb"
    con = duckdb.connect(str(db))
    init_schema(con)

    def report(at, odometer, trip_km, litres):
        for signal, value in (
            ("ododispvalue", odometer),
            ("drv1distnc", trip_km),
            ("drv1drvtm", trip_km * 60),  # a steady 60 km/h
            ("drv1avlfuelg", 100 * litres / trip_km if trip_km else 0),
        ):
            con.execute(
                "INSERT INTO signal_readings VALUES ('rts', 'TESTVIN0000000001', 'x', ?, ?, ?, ?, ?, true)",
                [at, at, signal, str(value), value],
            )

    at, trip_km, litres = T0, 0.0, 0.0
    report(at, 1000.0, trip_km, litres)
    for hours, km, rate in drives:
        at += timedelta(hours=hours)
        trip_km += km
        litres += km * rate / 100
        report(at, 1000.0 + trip_km, trip_km, litres)
    build_model(con, CODES, tmp_path / "settings.yaml")
    con.close()
    return db


def get(db: Path, path="/api/trips/pattern", **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get(path, params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def bands(d) -> dict:
    return {b["band"]: b for b in d["bands"]}


# hours after the report before, km, l/100 km
DRIVES = [
    (1, 3, 9.0),
    (1, 4.9, 9.0),  # under 5 km
    (2, 5, 8.0),
    (2, 19.9, 8.0),  # 5 to 20: exactly 5 km is here
    (3, 20, 7.0),
    (3, 60, 7.0),  # 20 to 100
    (5, 100, 6.0),
    (6, 250, 6.0),  # over 100
]


def test_every_stretch_is_put_in_its_band(tmp_path):
    d = get(make_db(tmp_path, DRIVES))
    b = bands(d)
    assert [x["band"] for x in d["bands"]] == [
        "under_5",
        "5_to_20",
        "20_to_100",
        "over_100",
    ]
    assert [(x["min_km"], x["max_km"]) for x in d["bands"]] == [
        (0, 5),
        (5, 20),
        (20, 100),
        (100, None),
    ]
    assert {k: v["stretches"] for k, v in b.items()} == {
        "under_5": 2,
        "5_to_20": 2,
        "20_to_100": 2,
        "over_100": 2,
    }
    assert b["under_5"]["km"] == 7.9 and b["5_to_20"]["km"] == 24.9
    assert b["20_to_100"]["km"] == 80 and b["over_100"]["km"] == 350
    assert d["stretches"] == 8 and d["km"] == pytest.approx(462.8)
    assert d["unclassified"] == {"stretches": 0, "km": 0}


def test_consumption_and_speed_of_a_band(tmp_path):
    d = get(make_db(tmp_path, DRIVES))
    b = bands(d)
    assert b["over_100"]["l_per_100km"] == 6.0 and b["over_100"]["fuel_l"] == 21.0
    assert b["20_to_100"]["l_per_100km"] == 7.0
    assert b["5_to_20"]["l_per_100km"] == 8.0
    assert (
        b["over_100"]["avg_speed_kmh"] == 60.0 and b["over_100"]["driving_hours"] == 5.8
    )
    # all of it: the litres of every stretch over the kilometres of every stretch
    litres = 7.9 * 0.09 + 24.9 * 0.08 + 80 * 0.07 + 350 * 0.06
    assert d["fuel_l"] == pytest.approx(litres, abs=0.01)
    assert d["l_per_100km"] == pytest.approx(100 * litres / 462.8, abs=0.01)


def test_no_consumption_from_a_few_kilometres(tmp_path):
    d = get(make_db(tmp_path, DRIVES))
    under = bands(d)["under_5"]
    assert d["min_km"] == 20 and under["km"] < 20
    assert under["l_per_100km"] is None and under["avg_speed_kmh"] is None
    assert under["fuel_l"] == pytest.approx(
        0.71, abs=0.01
    )  # the litres are still counted


def test_a_stretch_across_a_long_silence_is_not_put_in_a_band(tmp_path):
    d = get(
        make_db(
            tmp_path,
            [
                (2, 10, 8.0),
                (47.9, 30, 7.0),
                (48, 12, 7.0),
                (200, 300, 6.0),
                (1, 10, 8.0),
            ],
        )
    )
    assert d["gap_hours"] == 48
    assert d["unclassified"] == {"stretches": 2, "km": 312}
    assert {k: v["stretches"] for k, v in bands(d).items()} == {
        "under_5": 0, "5_to_20": 2, "20_to_100": 1, "over_100": 0,
    }  # fmt: skip
    assert d["stretches"] == 3 and d["km"] == 50
    # the month counts every stretch (as the Trends page does), its bands only those put in one
    (month,) = d["months"]
    assert (
        month["month"] == "2026-05" and month["stretches"] == 5 and month["km"] == 362
    )
    assert sum(b["stretches"] for b in month["bands"]) == 3


def test_by_month(tmp_path):
    # 1 May 08:00, then 20 days later, then into June
    d = get(
        make_db(
            tmp_path,
            [
                (24, 10, 8.0),
                (24, 150, 6.0),
                (24 * 30, 40, 7.0),
                (24, 3, 9.0),
                (24, 30, 7.0),
            ],
        )
    )
    may, june = d["months"]
    assert (may["month"], may["stretches"], may["km"]) == ("2026-05", 2, 160)
    assert may["l_per_100km"] == pytest.approx(100 * (0.8 + 9) / 160, abs=0.01)
    assert [b["stretches"] for b in may["bands"]] == [0, 1, 0, 1]
    assert (june["month"], june["stretches"], june["km"]) == ("2026-06", 3, 73)
    assert [b["stretches"] for b in june["bands"]] == [
        1,
        0,
        1,
        0,
    ]  # the 40 km across 30 days is in none
    assert [b["band"] for b in june["bands"]] == [
        "under_5",
        "5_to_20",
        "20_to_100",
        "over_100",
    ]


def test_a_period(tmp_path):
    db = make_db(
        tmp_path,
        [
            (24, 10, 8.0),
            (24, 150, 6.0),
            (24 * 30, 40, 7.0),
            (24, 3, 9.0),
            (24, 30, 7.0),
        ],
    )
    may = get(db, **{"from": "2026-05-01", "to": "2026-05-31"})
    assert may["stretches"] == 2 and [m["month"] for m in may["months"]] == ["2026-05"]
    assert may["unclassified"]["stretches"] == 0
    june = get(db, **{"from": "2026-06-01"})
    assert june["stretches"] == 2 and june["unclassified"] == {"stretches": 1, "km": 40}
    everything = {"from": "2026-01-01", "to": "2026-12-31"}
    assert get(db, **everything) == get(db)


def test_nothing_driven(tmp_path):
    d = get(make_db(tmp_path, []))
    assert (
        d["stretches"] == 0
        and d["km"] == 0
        and d["fuel_l"] == 0
        and d["l_per_100km"] is None
    )
    assert d["driving_hours"] == 0 and d["avg_speed_kmh"] is None
    assert [b["stretches"] for b in d["bands"]] == [0, 0, 0, 0] and d["months"] == []


@pytest.mark.parametrize("model", sorted(PROFILES))
def test_the_sample_cars(tmp_path, model):
    data = tmp_path / "data"
    generate(data, profile=PROFILES[model])
    db = tmp_path / "car.duckdb"
    ingest(
        data, db, REPO / "config" / "models" / model / "codes", data / "settings.yaml"
    )
    d = get(db)
    assert d["stretches"] > 100 and d["unclassified"]["stretches"] >= 0
    assert sum(b["stretches"] for b in d["bands"]) == d["stretches"]
    assert sum(b["km"] for b in d["bands"]) == pytest.approx(d["km"], abs=0.3)
    # the month totals are the Trends page's: same stretches, same consumption
    trends = {m["month"]: m for m in get(db, "/api/trends/monthly")}
    for month in d["months"]:
        assert month["l_per_100km"] == pytest.approx(
            trends[month["month"]]["l_per_100km"], abs=0.01
        )
        assert sum(b["stretches"] for b in month["bands"]) <= month["stretches"]
