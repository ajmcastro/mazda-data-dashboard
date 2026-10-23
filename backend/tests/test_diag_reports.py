"""Several diagnostic reports (three, made at different dates, in the sample data)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config" / "codes"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    root = tmp_path_factory.mktemp("diag")
    generate(root / "data")
    ingest(root / "data", root / "d.duckdb", CONFIG)
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(root / "d.duckdb"))
    yield TestClient(app)
    mp.undo()


def get(client, path, **params):
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_reports_are_listed_newest_first(client):
    reports = get(client, "/api/diag/reports")
    assert [r["taken_at"][:10] for r in reports] == [
        "2026-06-30",
        "2026-05-20",
        "2026-04-15",
    ]
    assert len({r["report_id"] for r in reports}) == 3
    assert all(r["obd_tests"] == 4 and r["vin"] == "SAMPLEVIN00000001" for r in reports)


def test_history_is_oldest_first_and_counters_grow(client):
    history = get(client, "/api/diag/history")
    assert [h["taken_at"][:10] for h in history] == [
        "2026-04-15",
        "2026-05-20",
        "2026-06-30",
    ]
    for key in (
        "lifetime_km",
        "lifetime_fuel_l",
        "ignition_cycles",
        "engine_hours",
        "odometer_km",
    ):
        values = [h[key] for h in history]
        assert values == sorted(values) and len(set(values)) == 3, key
    assert all(h["monitors_total"] == 4 and h["monitors_passed"] == 4 for h in history)
    assert [h["dtcs_listed"] for h in history] == [
        0,
        0,
        2,
    ]  # the fault shows up in the last report
    assert all(6.5 < h["lifetime_l_per_100km"] < 7.1 for h in history)


def test_each_report_has_its_own_content(client):
    oldest, newest = (
        get(client, "/api/diag/history")[0],
        get(client, "/api/diag/history")[-1],
    )
    old = get(client, f"/api/diag/reports/{oldest['report_id']}")
    new = get(client, f"/api/diag/reports/{newest['report_id']}")
    assert old["summary"]["lifetime_km"] < new["summary"]["lifetime_km"]
    assert old["dtc_lists"] == [] or all(not g["dtcs"] for g in old["dtc_lists"])
    assert {d["dtc_code"] for g in new["dtc_lists"] for d in g["dtcs"]} == {
        "C1B22",
        "XB2A92",
    }
    assert get(client, f"/api/diag/reports/{oldest['report_id']}/frames") == []
    assert len(get(client, f"/api/diag/reports/{newest['report_id']}/frames")) == 1


def test_comparing_two_reports_shows_what_changed(client):
    history = get(client, "/api/diag/history")
    a, b = history[0]["report_id"], history[-1]["report_id"]
    deltas = {
        (d["section"], d["key"]): d for d in get(client, "/api/diag/compare", a=a, b=b)
    }
    assert deltas[("IPT", "IGNCNTR")]["delta"] > 0
    assert deltas[("VOD - Distance/Fuel Used", "DT_L")]["delta"] == pytest.approx(
        history[-1]["lifetime_km"] - history[0]["lifetime_km"]
    )
    changed = [d for d in deltas.values() if d["delta"] != 0]
    assert 3 < len(changed) < len(deltas)  # some values moved, most counters did not
