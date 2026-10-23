"""Monthly metrics for the Trends page, checked against the sample data (1 Mar - 30 Jun 2026)."""

import shutil
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config" / "codes"
METRICS = [
    "distance_km", "l_per_100km", "fuel_l_est", "drives", "days_driven", "driving_hours",
    "avg_speed_kmh", "warning_events", "warning_codes", "fault_readouts", "distinct_faults",
    "new_faults", "tire_avg_kpa", "tire_min_kpa",
]  # fmt: skip


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    root = tmp_path_factory.mktemp("trends")
    generate(root / "data")
    db = root / "t.duckdb"
    ingest(root / "data", db, CONFIG)
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    yield TestClient(app), db
    mp.undo()


def months(client, **params):
    r = client.get("/api/trends/monthly", params=params)
    assert r.status_code == 200, r.text
    return {m["month"]: m for m in r.json()}


def test_one_row_per_month_with_all_metrics(env):
    client, _ = env
    rows = months(client)
    assert list(rows) == ["2026-03", "2026-04", "2026-05", "2026-06"]
    assert (
        rows["2026-03"]["days_in_month"] == 31
        and rows["2026-04"]["days_in_month"] == 30
    )
    for row in rows.values():
        assert all(row[k] is not None for k in METRICS), row
        assert row["partial"] is False and row["days_covered"] == row["days_in_month"]


def test_monthly_distance_adds_up_to_the_period_distance(env):
    client, _ = env
    total = sum(m["distance_km"] for m in months(client).values())
    assert total == pytest.approx(
        client.get("/api/overview").json()["km_in_range"], abs=0.5
    )


def test_consumption_matches_the_fuel_endpoint(env):
    client, _ = env
    fuel = {
        m["month"]: m["l_per_100km"] for m in client.get("/api/fuel/monthly").json()
    }
    for month, row in months(client).items():
        assert row["l_per_100km"] == pytest.approx(fuel[month], abs=0.01)


def test_counts_match_the_database(env):
    client, db = env
    con = duckdb.connect(str(db), read_only=True)
    expected = dict(
        con.execute(
            "SELECT strftime(date_trunc('month', triggered_at), '%Y-%m'), count(*) "
            "FROM warning_events GROUP BY 1"
        ).fetchall()
    )
    con.close()
    assert {k: v["warning_events"] for k, v in months(client).items()} == expected


def test_new_faults_land_in_the_month_they_first_appear(env):
    client, _ = env
    rows = months(client)
    assert rows["2026-03"]["new_faults"] == 2  # U0198 and U3000 start in March
    assert rows["2026-04"]["new_faults"] == 0 and rows["2026-05"]["new_faults"] == 0
    assert rows["2026-06"]["new_faults"] == 1  # C1B22


def test_faults_first_reported_on_the_first_day_are_not_new(env, tmp_path, monkeypatch):
    client, db = env
    copy = tmp_path / "first.duckdb"
    shutil.copy(db, copy)
    con = duckdb.connect(str(copy))
    first = con.execute(
        "SELECT transaction_id FROM dtc_headers ORDER BY copied_at LIMIT 1"
    ).fetchone()[0]
    con.execute(
        "INSERT INTO dtc_readings VALUES (?, 'IC', 'fault', 'P0420:00', 'P0420', '00', 1, '08', 3)",
        [first],
    )  # reported on the first day of data
    con.close()
    monkeypatch.setenv("MAZDA_DB", str(copy))
    rows = months(client)
    assert rows["2026-03"]["new_faults"] == 2  # unchanged: P0420 does not count as new
    assert rows["2026-03"]["distinct_faults"] == 3  # but it is a fault that month


def test_the_tire_leak_shows_in_the_lowest_reading(env):
    client, _ = env
    rows = months(client)
    assert rows["2026-05"]["tire_min_kpa"] >= 230
    assert rows["2026-06"]["tire_min_kpa"] <= 190
    assert rows["2026-06"]["tire_avg_kpa"] < rows["2026-05"]["tire_avg_kpa"]


def test_a_period_cutting_months_marks_them_partial(env):
    client, _ = env
    rows = months(client, **{"from": "2026-04-10", "to": "2026-05-20"})
    assert list(rows) == ["2026-04", "2026-05"]
    april, may = rows["2026-04"], rows["2026-05"]
    assert (april["days_covered"], april["partial"]) == (21, True)
    assert (may["days_covered"], may["partial"]) == (20, True)
    full = months(client)
    assert (
        april["distance_km"] < full["2026-04"]["distance_km"]
    )  # only the days inside the period
    assert april["warning_events"] < full["2026-04"]["warning_events"]


def test_a_period_inside_one_month(env):
    client, _ = env
    rows = months(client, **{"from": "2026-05-05", "to": "2026-05-09"})
    assert list(rows) == ["2026-05"] and rows["2026-05"]["days_covered"] == 5


def test_months_without_data_are_kept_as_gaps_not_zeros(env, tmp_path, monkeypatch):
    client, db = env
    gap_db = tmp_path / "gap.duckdb"
    shutil.copy(db, gap_db)  # a copy of the database with all of May removed
    con = duckdb.connect(str(gap_db))
    for table, col in [
        ("signal_readings", "created_at"), ("warning_events", "triggered_at"),
        ("dtc_headers", "triggered_at"), ("dtc_snapshots", "triggered_at"),
        ("diag_reports", "taken_at"),  # a diagnostic report also carries an odometer reading
    ]:  # fmt: skip
        con.execute(f"DELETE FROM {table} WHERE strftime({col}, '%Y-%m') = '2026-05'")
    con.execute(
        "DELETE FROM dtc_readings WHERE transaction_id NOT IN (SELECT transaction_id FROM dtc_headers)"
    )
    con.close()

    monkeypatch.setenv("MAZDA_DB", str(gap_db))
    rows = months(client)
    assert list(rows) == [
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
    ]  # May is still listed
    assert all(rows["2026-05"][k] is None for k in METRICS)
    assert rows["2026-05"]["days_covered"] == 31  # inside the data span, just no data
    assert rows["2026-06"]["distance_km"] is not None


def test_empty_and_invalid_periods(env):
    client, _ = env
    assert client.get("/api/trends/monthly", params={"from": "2027-01-01"}).json() == []
    assert (
        client.get(
            "/api/trends/monthly", params={"from": "2026-05-02", "to": "2026-05-01"}
        ).status_code
        == 422
    )
