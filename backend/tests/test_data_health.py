"""GET /api/data/health: what the exports cover, the silences and the Invalid signals (PLAN.md M46)."""

from datetime import datetime
from itertools import pairwise
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.api.health import DATA_KINDS, GAP_HOURS, MAX_GAPS
from mazda_dash.ingest import ingest
from mazda_dash.pack import GPS_SIGNALS, used_signals
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]


@pytest.fixture(scope="module")
def dbs(tmp_path_factory):
    root = tmp_path_factory.mktemp("health")
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


def get(db: Path, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get("/api/data/health", params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def stamps(db: Path, sql: str) -> list[datetime]:
    with duckdb.connect(str(db), read_only=True) as con:
        return [r[0] for r in con.execute(sql).fetchall()]


@pytest.mark.parametrize("pid", list(PROFILES))
def test_each_kind_of_file_is_counted_as_the_tables_hold_it(dbs, pid):
    got = get(dbs[pid])
    assert [k["kind"] for k in got["kinds"]] == [k for k, _, _ in DATA_KINDS]
    assert got["has_data"]
    with duckdb.connect(str(dbs[pid]), read_only=True) as con:
        for k in got["kinds"]:
            _, source, ts = next(d for d in DATA_KINDS if d[0] == k["kind"])
            n, days = con.execute(
                f"SELECT count(*), count(DISTINCT CAST({ts} AS DATE)) FROM {source} WHERE {ts} IS NOT NULL"
            ).fetchone()
            assert (k["records"], k["days"]) == (n, days), k["kind"]
            assert (k["first_at"] is None) == (n == 0)
    # a status snapshot is one report, however many signals it carries
    rts = next(k for k in got["kinds"] if k["kind"] == "rts")
    assert rts["records"] == got["snapshots"]
    assert rts["days"] == got["days_with_status"]


@pytest.mark.parametrize("pid", list(PROFILES))
def test_the_days_looked_at_are_the_span_of_the_data_without_a_period(dbs, pid):
    got = get(dbs[pid])
    firsts = [k["first_at"] for k in got["kinds"] if k["first_at"]]
    lasts = [k["last_at"] for k in got["kinds"] if k["last_at"]]
    assert got["range_from"] == min(firsts)[:10] and got["range_to"] == max(lasts)[:10]
    span = datetime.fromisoformat(got["range_to"]) - datetime.fromisoformat(
        got["range_from"]
    )
    assert got["days_in_range"] == span.days + 1
    assert 0 < got["days_with_status"] <= got["days_in_range"]


@pytest.mark.parametrize("pid", list(PROFILES))
def test_gaps_are_the_silences_between_consecutive_status_reports(dbs, pid):
    got = get(dbs[pid])
    times = stamps(
        dbs[pid], "SELECT created_at FROM v_vehicle_status ORDER BY created_at"
    )
    hours = [(b - a).total_seconds() / 3600 for a, b in pairwise(times)]
    long = sorted((h for h in hours if h >= GAP_HOURS), reverse=True)
    assert got["gap_threshold_hours"] == GAP_HOURS
    assert got["gaps_total"] == len(long)
    assert [g["hours"] for g in got["gaps"]] == [round(h, 1) for h in long[:MAX_GAPS]]
    assert got["longest_gap_hours"] == round(max(hours), 1)
    for g in got["gaps"]:
        assert g["from_at"] < g["to_at"]
    # the usual time between two reports is far below the threshold: a gap is an exception
    assert got["median_gap_hours"] < GAP_HOURS


@pytest.mark.parametrize("pid", list(PROFILES))
def test_invalid_signals_are_only_those_the_car_flagged_and_only_signals_a_view_reads(
    dbs, pid
):
    got = get(dbs[pid])
    judged = set(used_signals())
    for s in got["invalid"]:
        assert s["invalid"] > 0 and s["readings"] >= s["invalid"]
        assert s["pct"] == round(100 * s["invalid"] / s["readings"], 1)
        assert s["signal"] not in GPS_SIGNALS
        if s["source"] == "rts":
            assert s["signal"] in judged  # the phone's pack carries no other rts signal
    assert [s["pct"] for s in got["invalid"]] == sorted(
        (s["pct"] for s in got["invalid"]), reverse=True
    )
    assert got["invalid_readings"] == sum(s["invalid"] for s in got["invalid"])
    assert got["readings_checked"] > got["invalid_readings"]
    with duckdb.connect(str(dbs[pid]), read_only=True) as con:
        marks = ", ".join(f"'{s}'" for s in judged)
        n = con.execute(
            f"SELECT count(*) FROM signal_readings WHERE valid IS FALSE AND (source <> 'rts' OR signal IN ({marks}))"
        ).fetchone()[0]
    assert got["invalid_readings"] == n


def test_the_sample_car_has_invalid_readings_to_show(dbs):
    """The generator flags a few values Invalid on purpose (the driver's door among them)."""
    got = get(dbs["cx5"])
    assert got["invalid"], "the page would have nothing to show on the demo"
    assert ("vis", "drstatdrv") in {(s["source"], s["signal"]) for s in got["invalid"]}


def test_a_period_only_counts_what_is_inside_it(dbs):
    whole = get(dbs["cx5"])
    april = get(dbs["cx5"], **{"from": "2026-04-01", "to": "2026-04-30"})
    assert (april["range_from"], april["range_to"], april["days_in_range"]) == (
        "2026-04-01",
        "2026-04-30",
        30,
    )
    assert 0 < april["snapshots"] < whole["snapshots"]
    assert april["days_with_status"] <= 30
    for k in april["kinds"]:
        if k["records"]:
            assert (
                "2026-04-01" <= k["first_at"][:10] and k["last_at"][:10] <= "2026-04-30"
            )
    for g in april[
        "gaps"
    ]:  # a silence is between two reports of the period, never across its edge
        assert g["from_at"][:10] >= "2026-04-01" and g["to_at"][:10] <= "2026-04-30"
    assert april["readings_checked"] < whole["readings_checked"]


def test_a_period_wider_than_the_data_changes_nothing_but_the_days_looked_at(dbs):
    whole = get(dbs["cx5"])
    wide = get(dbs["cx5"], **{"from": "2020-01-01", "to": "2030-12-31"})
    same = (
        "snapshots",
        "days_with_status",
        "gaps",
        "invalid",
        "kinds",
        "gaps_total",
        "longest_gap_hours",
    )
    assert {k: wide[k] for k in same} == {k: whole[k] for k in same}
    assert wide["days_in_range"] > whole["days_in_range"]


def test_an_empty_period_is_an_empty_answer_not_an_error(dbs):
    got = get(dbs["cx5"], **{"from": "2027-01-01", "to": "2027-01-31"})
    assert got["has_data"] is False
    assert got["snapshots"] == 0 and got["gaps"] == [] and got["invalid"] == []
    assert got["longest_gap_hours"] is None and got["median_gap_hours"] is None
    assert [k["records"] for k in got["kinds"]] == [0] * len(DATA_KINDS)
    assert got["days_in_range"] == 31


def test_the_two_cars_answer_for_themselves(dbs):
    cx5, cx60 = get(dbs["cx5"]), get(dbs["cx60"])
    assert cx5["range_from"] != cx60["range_from"]
    assert cx5["snapshots"] != cx60["snapshots"]
