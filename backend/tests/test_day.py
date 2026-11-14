"""One day at a glance (PLAN.md M49): GET /api/day."""

from datetime import datetime
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


def make_db(tmp_path, reports, zone="Europe/Lisbon") -> Path:
    """A database with status reports: (UTC time, odometer km, fuel level %, trip counter km)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "settings.yaml").write_text(f"car_timezone: {zone}\ntank_litres: 50\n")
    db = tmp_path / "car.duckdb"
    con = duckdb.connect(str(db))
    init_schema(con)
    for at, odometer, fuel, trip in reports:
        for signal, value in (
            ("ododispvalue", odometer),
            ("fuelsegementdactl", fuel),
            ("drv1distnc", trip),
            ("drv1drvtm", trip * 60),
            ("drv1avlfuelg", 7.0),
        ):
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
        r = TestClient(app).get("/api/day", params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def kinds(d) -> list[str]:
    return [e["kind"] for e in d["entries"]]


# Lisbon is UTC+1 in summer: 23:30 UTC on 2 June is 00:30 on 3 June there
REPORTS = [
    (datetime(2026, 6, 1, 9, 0), 1000, 60, 0),
    (datetime(2026, 6, 2, 22, 30), 1040, 50, 40),  # 23:30 local, still 2 June
    (datetime(2026, 6, 2, 23, 30), 1060, 45, 60),  # 00:30 local on 3 June
    (datetime(2026, 6, 5, 8, 0), 1080, 95, 80),  # filled up, seen on the 5th
]


def test_a_day_is_the_cars_local_day(tmp_path):
    db = make_db(tmp_path, REPORTS)
    second = get(db, date="2026-06-02")
    assert second["time_zone"] == "Europe/Lisbon"
    assert kinds(second) == ["drive", "status"]
    drive, status = second["entries"]
    assert (drive["local"], drive["local_until"], drive["km"]) == (
        "2026-06-01 10:00",
        "2026-06-02 23:30",
        40,
    )
    assert (
        status["local"] == "2026-06-02 23:30"
        and status["d_fuel_pct"] == -10
        and status["km"] == 40
    )
    third = get(db, date="2026-06-03")  # 23:30 UTC on the 2nd belongs here
    assert kinds(third) == ["drive", "status"]
    assert third["entries"][1]["local"] == "2026-06-03 00:30"
    assert (
        third["entries"][1]["at"] == "2026-06-02T23:30:00Z"
    )  # the UTC time is kept as it is
    # in UTC the same report is on the 2nd
    utc = make_db(tmp_path / "utc", REPORTS, zone="UTC")
    assert (
        len(get(utc, date="2026-06-02")["entries"]) == 4
        and get(utc, date="2026-06-03")["entries"] == []
    )


def test_a_drive_and_a_fill_up_are_on_the_day_they_were_seen(tmp_path):
    db = make_db(tmp_path, REPORTS)
    fifth = get(db, date="2026-06-05")
    assert kinds(fifth) == ["drive", "status", "fill_up"]
    fill = fifth["entries"][2]
    assert (
        fill["d_fuel_pct"] == 50 and fill["litres"] == 25 and fill["doubtful"] is True
    )  # across 2 days
    assert (
        fill["local"] == "2026-06-03 00:30"
        and fill["local_until"] == "2026-06-05 09:00"
    )
    assert get(db, date="2026-06-04")["entries"] == []


def test_previous_and_next_skip_days_without_anything(tmp_path):
    db = make_db(tmp_path, REPORTS)
    d = get(db, date="2026-06-03")
    assert (d["previous"], d["next"]) == ("2026-06-02", "2026-06-05")
    assert (d["first_day"], d["last_day"]) == ("2026-06-01", "2026-06-05")
    empty = get(db, date="2026-06-04")
    assert empty["entries"] == [] and (empty["previous"], empty["next"]) == (
        "2026-06-03",
        "2026-06-05",
    )
    first = get(db, date="2026-06-01")
    assert first["previous"] is None and first["next"] == "2026-06-02"
    far = get(db, date="2030-01-01")
    assert (
        far["entries"] == [] and far["previous"] == "2026-06-05" and far["next"] is None
    )


def test_without_a_date_it_is_the_newest_day(tmp_path):
    d = get(make_db(tmp_path, REPORTS))
    assert d["date"] == "2026-06-05" and d["next"] is None and len(d["entries"]) == 3


def test_an_empty_database_and_a_bad_date(tmp_path):
    db = make_db(tmp_path, [])
    assert get(db) == {
        "date": None, "time_zone": "Europe/Lisbon", "first_day": None, "last_day": None,
        "previous": None, "next": None, "entries": [],
    }  # fmt: skip
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        for bad in ("x", "2026-02-30", ""):
            assert (
                TestClient(app).get("/api/day", params={"date": bad}).status_code == 422
            )
    finally:
        mp.undo()


@pytest.fixture(scope="module")
def demo(tmp_path_factory):
    root = tmp_path_factory.mktemp("day")
    out = {}
    for pid, profile in PROFILES.items():
        data = root / pid
        generate(data, profile=profile)
        db = root / f"{pid}.duckdb"
        ingest(
            data, db, REPO / "config" / "models" / pid / "codes", data / "settings.yaml"
        )
        out[pid] = db
    return out


@pytest.mark.parametrize("pid", list(PROFILES))
def test_the_sample_cars(demo, pid):
    db = demo[pid]
    newest = get(db)
    assert newest["date"] == newest["last_day"] and newest["entries"]
    # walking back day by day reaches the first day, every day has something, and every kind shows up
    seen, day, steps = set(), newest, 0
    while True:
        assert day["entries"], day["date"]
        seen |= set(kinds(day))
        times = [
            (e["until"] or e["at"])
            for e in day["entries"]
            if e["kind"] in ("status", "doors", "alarm")
        ]
        assert times == sorted(times)  # in time order
        for e in day["entries"]:
            placed = (
                e["local_until"] if e["kind"] in ("drive", "fill_up") else e["local"]
            )
            assert placed.startswith(
                day["date"]
            )  # every entry belongs to the day asked for
        if day["previous"] is None:
            break
        day, steps = get(db, date=day["previous"]), steps + 1
    assert day["date"] == newest["first_day"] and steps > 60
    assert {"drive", "status", "warning", "readout", "alarm", "fill_up", "diag"} <= seen


def test_a_day_with_a_fault_read_out_shows_what_was_around_it(demo):
    db = demo["cx5"]
    day = get(db)
    while day["previous"] and "readout" not in kinds(day):
        day = get(db, date=day["previous"])
    readout = next(e for e in day["entries"] if e["kind"] == "readout")
    assert readout["ref"] and readout["n"] >= 0 and "local" in readout
    if readout["n"]:
        assert readout["text"]  # the codes it listed
