"""GET /api/activity/pattern: when the car is used, by hour and weekday, in its local time (PLAN.md M35)."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]


@pytest.fixture(scope="module")
def dbs(tmp_path_factory):
    root = tmp_path_factory.mktemp("activity")
    out = {}
    for pid, profile in PROFILES.items():
        data = root / pid
        generate(data, profile=profile)
        db = root / f"{pid}.duckdb"
        model_dir = REPO / "config" / "models" / pid
        ingest(data, db, model_dir / "codes", data / "settings.yaml")
        out[pid] = db
    return out


def get(db: Path, path: str, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get(path, params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def test_the_pattern_has_every_hour_and_weekday_and_the_cars_time_zone(dbs):
    p = get(dbs["cx5"], "/api/activity/pattern")
    assert p["time_zone"] == "Europe/Lisbon"
    assert [h["hour"] for h in p["hours"]] == list(range(24))
    assert [w["weekday"] for w in p["weekdays"]] == list(range(7))
    assert sum(h["drives"] for h in p["hours"]) > 0
    assert any(h["warning_codes"] > 0 for h in p["hours"])


def test_drives_and_km_add_up_to_the_close_trip_segments(dbs):
    segs = [
        s
        for s in get(dbs["cx5"], "/api/trips/segments", limit=5000)
        if s["gap_hours"] <= 3
    ]
    p = get(dbs["cx5"], "/api/activity/pattern")
    assert sum(h["drives"] for h in p["hours"]) == len(segs)
    assert sum(h["km"] for h in p["hours"]) == pytest.approx(
        sum(s["km"] for s in segs), abs=0.1 * 24
    )
    assert sum(w["km"] for w in p["weekdays"]) == pytest.approx(
        sum(s["km"] for s in segs), abs=0.1 * 120
    )


def test_weekdays_count_days_not_events(dbs):
    p = get(dbs["cx5"], "/api/activity/pattern")
    span = p["weekdays"]
    total_days = sum(w["calendar_days"] for w in span)
    # the sample data covers 1 March - 30 June, local time
    assert 118 <= total_days <= 122
    for w in span:
        assert 0 <= w["active_days"] <= w["calendar_days"]
        assert 0 <= w["warning_days"] <= w["active_days"]


def test_a_period_only_counts_what_is_inside_it(dbs):
    june = {"from": "2026-06-01", "to": "2026-06-30"}
    p = get(dbs["cx5"], "/api/activity/pattern", **june)
    assert 29 <= sum(w["calendar_days"] for w in p["weekdays"]) <= 31
    allp = get(dbs["cx5"], "/api/activity/pattern")
    assert sum(h["drives"] for h in p["hours"]) < sum(
        h["drives"] for h in allp["hours"]
    )


def test_each_car_uses_its_own_time_zone(dbs):
    assert get(dbs["cx60"], "/api/activity/pattern")["time_zone"] == "Europe/Berlin"


def test_the_conversion_to_local_time_handles_summer_time():
    """23:30 UTC on a summer day is 00:30 in Lisbon, the next day (a Sunday evening becomes Monday)."""
    con = duckdb.connect(":memory:")
    sql = "SELECT timezone('Europe/Lisbon', make_timestamptz(epoch_us(TIMESTAMP '{}')))"
    assert con.execute(sql.format("2026-06-14 23:30:00")).fetchone()[0] == datetime(
        2026, 6, 15, 0, 30
    )
    assert con.execute(sql.format("2026-01-14 23:30:00")).fetchone()[0] == datetime(
        2026, 1, 14, 23, 30
    )


def test_the_view_gives_local_time_for_both_kinds_of_moment(dbs):
    con = duckdb.connect(str(dbs["cx5"]), read_only=True)
    rows = con.execute(
        "SELECT kind, at_utc, local_at FROM v_activity_events"
    ).fetchall()
    assert {r[0] for r in rows} == {"warning", "drive"}
    summer = [r for r in rows if r[1].month == 6]
    assert summer and all(r[2] - r[1] == timedelta(hours=1) for r in summer)
    winter = [r for r in rows if r[1].month == 3 and r[1].day < 29]
    assert winter and all(r[2] - r[1] == timedelta(hours=0) for r in winter)
