"""GET /api/status/occupancy: who rides, from the seat belts (PLAN.md M37)."""

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
    root = tmp_path_factory.mktemp("occupancy")
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


def test_a_car_that_sends_no_belts_says_so(dbs):
    o = get(dbs["cx5"], "/api/status/occupancy")
    assert o["available"] is False and o["readings"] == 0 and o["months"] == []


def test_the_counts_equal_a_hand_count_of_the_raw_signals(dbs):
    o = get(dbs["cx60"], "/api/status/occupancy")
    assert o["available"] is True
    con = duckdb.connect(str(dbs["cx60"]), read_only=True)
    snap = con.execute(
        """SELECT created_at,
                  max(value_num) FILTER (WHERE signal = 'firstrowbuckledriver') AS d,
                  max(value_num) FILTER (WHERE signal = 'firstrowbucklepsngr') AS p,
                  max(value_num) FILTER (WHERE signal = 'rear_left_seatbelt_used') AS rl,
                  max(value_num) FILTER (WHERE signal = 'rear_right_seatbelt_used') AS rr
           FROM signal_readings WHERE source = 'rts' GROUP BY 1"""
    ).fetchall()
    belted = [r for r in snap if r[1] == 1]
    assert o["readings"] == len([r for r in snap if r[1] is not None])
    assert o["belted_readings"] == len(belted)
    assert o["passenger_readings"] == len([r for r in belted if r[2] == 1])
    assert o["rear_readings"] == len([r for r in belted if r[3] == 1 or r[4] == 1])
    assert o["driver_only_readings"] == len(
        [r for r in belted if not (r[2] or r[3] or r[4])]
    )
    assert 0 < o["passenger_readings"] < o["belted_readings"]


def test_every_share_has_the_belted_readings_as_its_base(dbs):
    o = get(dbs["cx60"], "/api/status/occupancy")
    assert o["driver_only_readings"] <= o["belted_readings"] <= o["readings"]
    assert o["passenger_readings"] <= o["belted_readings"]
    assert o["rear_readings"] <= o["belted_readings"]
    assert sum(m["belted_readings"] for m in o["months"]) == o["belted_readings"]
    assert sum(m["passenger_readings"] for m in o["months"]) == o["passenger_readings"]


def test_a_period_only_counts_what_is_inside_it(dbs):
    whole = get(dbs["cx60"], "/api/status/occupancy")
    one_month = whole["months"][1]["month"]
    first, last = f"{one_month}-01", f"{one_month}-28"
    part = get(dbs["cx60"], "/api/status/occupancy", **{"from": first, "to": last})
    assert [m["month"] for m in part["months"]] == [one_month]
    assert part["belted_readings"] <= whole["months"][1]["belted_readings"]
    assert part["belted_readings"] < whole["belted_readings"]
