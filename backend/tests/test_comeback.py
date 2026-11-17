"""Fault comeback (PLAN.md M67): waits between a fault's read-outs, and the Kaplan–Meier estimate."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.api.comeback import fault_comeback, median_wait, still_away
from mazda_dash.ingest import ingest
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
T0 = datetime(2026, 6, 1, 10)


def fake_db(readouts):
    """``readouts``: one list per read-out (a week apart) of (ecu, kind, code); stand-ins for the two tables and
    for v_dtc_events (titles)."""
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE dtc_headers (transaction_id VARCHAR, triggered_at TIMESTAMP, copied_at TIMESTAMP)"
    )
    con.execute(
        "CREATE TABLE dtc_readings (transaction_id VARCHAR, ecu VARCHAR, kind VARCHAR, dtc_code VARCHAR)"
    )
    con.execute(
        "CREATE TABLE v_dtc_events (ecu VARCHAR, dtc_code VARCHAR, title VARCHAR, known BOOLEAN)"
    )
    for i, units in enumerate(readouts):
        tx = f"t{i}"
        con.execute(
            "INSERT INTO dtc_headers VALUES (?, ?, NULL)",
            [tx, T0 + timedelta(days=7 * i)],
        )
        for ecu, kind, code in units:
            con.execute(
                "INSERT INTO dtc_readings VALUES (?, ?, ?, ?)", [tx, ecu, kind, code]
            )
            if kind == "fault":
                con.execute(
                    "INSERT INTO v_dtc_events VALUES (?, ?, ?, ?)",
                    [ecu, code, "Described", code == "U0001"],
                )
    return con


ON = ("BCM", "fault", "U0001")
OFF = ("BCM", "none", None)
ERR = ("BCM", "read_error", None)


def one(readouts):
    (f,) = fault_comeback(fake_db(readouts)).faults
    return f


def test_a_fault_never_cleared_has_no_wait():
    f = one([[ON], [ON], [ON]])
    assert f.waits == [] and f.listed == 3 and f.readouts == 3 and f.listed_now
    assert f.title == "Described"


def test_waits_end_when_the_fault_is_listed_again_or_are_censored():
    f = one([[ON], [OFF], [OFF], [ON], [OFF], [ON], [OFF], [OFF]])
    assert [(w.days, w.back) for w in f.waits] == [
        (14.0, True),
        (7.0, True),
        (7.0, False),
    ]
    assert (
        f.ended == 2 and not f.enough and f.still_away == [] and f.median_days is None
    )
    assert not f.listed_now and f.last_listed_at == (T0 + timedelta(days=35)).replace(
        tzinfo=UTC
    )


def test_a_read_error_says_nothing_and_another_unit_is_not_counted():
    f = one(
        [
            [ON, ("DCM", "none", None)],
            [ERR, ("DCM", "none", None)],
            [ON, ("DCM", "none", None)],
        ]
    )
    assert f.waits == [] and f.readouts == 2


def test_the_estimate_from_three_waits_that_ended():
    f = one(
        [
            [ON],
            [OFF],
            [ON],
            [OFF],
            [OFF],
            [OFF],
            [OFF],
            [ON],
            [OFF],
            [OFF],
            [OFF],
            [ON],
            [OFF],
            [OFF],
        ]
    )
    # back after 7, 28 and 21 days; one wait open for 7 days at the newest read-out
    assert [(w.days, w.back) for w in f.waits] == [
        (7.0, True),
        (28.0, True),
        (21.0, True),
        (7.0, False),
    ]
    assert f.enough and f.median_days == 21.0
    assert [(s.days, s.pct) for s in f.still_away] == [(7, 75.0), (30, 0.0), (90, 0.0)]


def test_kaplan_meier_by_hand():
    waits = [(5.0, True), (10.0, False), (20.0, True), (30.0, True)]
    assert still_away(waits, 4) == 1.0
    assert still_away(waits, 5) == pytest.approx(0.75)  # 1 of 4
    assert still_away(waits, 20) == pytest.approx(
        0.75 * 0.5
    )  # 1 of the 2 still waiting at 20 days
    assert still_away(waits, 30) == pytest.approx(0.0)
    assert median_wait(waits) == 20.0
    assert (
        median_wait([(5.0, True), (9.0, False), (9.0, False)]) is None
    )  # never reaches half


def test_faults_are_ordered_by_how_often_they_were_listed():
    faults = fault_comeback(
        fake_db([[ON, ("DCM", "fault", "U0002")], [ON, ("DCM", "none", None)]])
    ).faults
    assert [(f.ecu, f.dtc_code, f.listed) for f in faults] == [
        ("BCM", "U0001", 2),
        ("DCM", "U0002", 1),
    ]
    assert faults[1].title is None  # not described by the owner


def test_no_read_outs():
    assert fault_comeback(fake_db([])).faults == []


@pytest.fixture(scope="module")
def samples(tmp_path_factory):
    root = tmp_path_factory.mktemp("comeback")
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


def get(db):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get("/api/dtcs/comeback")
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def test_the_cx60_sample_has_a_fault_that_comes_and_goes(samples):
    ecu, code = PROFILES["cx60"].flapping_fault
    (f,) = [
        f
        for f in get(samples["cx60"])["faults"]
        if f["ecu"] == ecu and code.startswith(f["dtc_code"])
    ]
    assert f["enough"] and f["ended"] == 3 and f["median_days"] is not None
    assert all(not x["enough"] for x in get(samples["cx5"])["faults"])
