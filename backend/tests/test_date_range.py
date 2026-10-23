"""The from/to filter on the period-based endpoints, checked against the sample data
(1 March - 30 June 2026), which has trips, faults, warnings and a diagnostic report."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config" / "codes"
PERIOD_ENDPOINTS = [
    "/api/odometer/daily", "/api/fuel/monthly", "/api/trips/segments", "/api/status/timeline",
    "/api/doors/timeline", "/api/alarms", "/api/warnings/frequency", "/api/warnings/daily",
    "/api/dtcs/events", "/api/dtcs/readouts",
]  # fmt: skip


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    root = tmp_path_factory.mktemp("range")
    generate(root / "data")
    ingest(root / "data", root / "r.duckdb", CONFIG)
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(root / "r.duckdb"))
    yield TestClient(app)
    mp.undo()


def get(client, path, **params):
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_span_gives_the_first_and_last_day(client):
    assert get(client, "/api/span") == {
        "first_day": "2026-03-01",
        "last_day": "2026-06-30",
    }


def test_a_range_covering_everything_changes_nothing(client):
    full = {"from": "2026-03-01", "to": "2026-06-30"}
    for path in PERIOD_ENDPOINTS:
        assert get(client, path, **full) == get(client, path), path
    assert get(client, "/api/dtcs/frequency", **full) == get(
        client, "/api/dtcs/frequency"
    )


def test_endpoints_only_return_rows_inside_the_range(client):
    rng = {"from": "2026-04-01", "to": "2026-04-30"}
    days = get(client, "/api/odometer/daily", **rng)
    assert days and all("2026-04-01" <= d["day"] <= "2026-04-30" for d in days)
    segments = get(client, "/api/trips/segments", limit=5000, **rng)
    assert segments and all(s["end_at"].startswith("2026-04") for s in segments)
    assert [m["month"] for m in get(client, "/api/fuel/monthly", **rng)] == ["2026-04"]
    status = get(client, "/api/status/timeline", **rng)
    assert status and all(p["created_at"].startswith("2026-04") for p in status)
    warnings = get(client, "/api/warnings/daily", **rng)
    assert warnings and all(w["day"].startswith("2026-04") for w in warnings)
    events = get(client, "/api/warnings/events", limit=1000, **rng)
    assert events["total"] and all(
        e["triggered_at"].startswith("2026-04") for e in events["items"]
    )
    assert get(client, "/api/alarms", **rng)[0]["created_at"].startswith("2026-04")


def test_the_last_day_is_included_whole(client):
    day = {"from": "2026-06-30", "to": "2026-06-30"}
    assert get(client, "/api/status/timeline", **day)  # readings late on 30 June
    before = {"from": "2026-06-01", "to": "2026-06-29"}
    assert get(client, "/api/overview", **before)["odometer_at"] < "2026-06-30"
    assert get(client, "/api/overview", **day)["odometer_at"].startswith("2026-06-30")


def test_distance_in_range_matches_the_daily_odometer(client):
    rng = {"from": "2026-04-01", "to": "2026-04-30"}
    expected = sum(
        d["km_since_previous"] for d in get(client, "/api/odometer/daily", **rng)
    )
    overview = get(client, "/api/overview", **rng)
    assert overview["km_in_range"] == pytest.approx(expected)
    assert (
        overview["range_from"] == "2026-04-01" and overview["range_to"] == "2026-04-30"
    )
    everything = get(client, "/api/overview")
    first_reading = get(client, "/api/odometer/daily")[0]["odometer_km"]
    # with no start the baseline is the lowest reading, a warning's whole-km odometer can be
    # up to 1 km below the first day's highest reading
    assert everything["km_in_range"] == pytest.approx(
        everything["odometer_km"] - first_reading, abs=1.5
    )
    assert (
        everything["range_from"] == "2026-03-01"
    )  # open ends show the data's own span


def test_warning_shares_are_relative_to_the_range(client):
    rng = {"from": "2026-06-12", "to": "2026-06-12"}  # the spike day
    freq = get(client, "/api/warnings/frequency", **rng)
    assert {w["code"] for w in freq} >= {"$1C4", "$201"}
    assert max(w["pct_of_events"] for w in freq) <= 100
    spike = next(w for w in freq if w["code"] == "$1C4")
    assert spike["events"] >= 48 and spike["days_seen"] == 1
    assert spike["first_seen"].startswith("2026-06-12")


def test_active_faults_are_a_state_and_ignore_the_range(client):
    early = {"from": "2026-03-01", "to": "2026-03-10"}  # before any fault was reported
    assert get(client, "/api/dtcs/events", **early) == []
    listed = get(client, "/api/dtcs/frequency", **early)
    active = {
        (f["ecu"], f["dtc_code"]) for f in listed if f["active_in_latest_readout"]
    }
    assert active == {("BCM", "U0198"), ("ADU", "C1B22")}
    assert all(
        f["readouts"] == 0 for f in listed
    )  # none were reported inside the range
    assert get(client, "/api/overview", **early)["active_faults"] == 2
    wide = get(client, "/api/dtcs/frequency")
    assert {f["dtc_code"] for f in wide} == {
        "U0198",
        "C1B22",
        "U3000",
    }  # cleared ones too


def test_cleared_faults_only_appear_when_reported_in_the_range(client):
    in_range = get(
        client, "/api/dtcs/frequency", **{"from": "2026-03-25", "to": "2026-04-15"}
    )
    assert "U3000" in {f["dtc_code"] for f in in_range}
    outside = get(
        client, "/api/dtcs/frequency", **{"from": "2026-06-01", "to": "2026-06-30"}
    )
    assert "U3000" not in {f["dtc_code"] for f in outside}


def test_an_empty_range_gives_empty_results_not_errors(client):
    nothing = {"from": "2027-01-01", "to": "2027-01-31"}
    for path in PERIOD_ENDPOINTS:
        if path in ("/api/dtcs/events",):
            assert get(client, path, **nothing) == []
        else:
            assert get(client, path, **nothing) == [], path
    o = get(client, "/api/overview", **nothing)
    assert o["has_data_in_range"] is False and o["km_in_range"] is None
    assert o["warnings_in_range"] == 0 and o["l_per_100km_in_range"] is None
    assert o["status"]["fuel_level_pct"] is None
    assert o["warnings_total"] > 0  # all-time totals are still reported


def test_open_ended_ranges(client):
    only_from = get(client, "/api/odometer/daily", **{"from": "2026-06-20"})
    assert only_from and all(d["day"] >= "2026-06-20" for d in only_from)
    only_to = get(client, "/api/odometer/daily", to="2026-03-05")
    assert only_to and all(d["day"] <= "2026-03-05" for d in only_to)


def test_bad_input_is_rejected(client):
    for params in (
        {"from": "2026-05-02", "to": "2026-05-01"},
        {"from": "not-a-date"},
        {"to": "2026-13-01"},
    ):
        assert client.get("/api/overview", params=params).status_code == 422
