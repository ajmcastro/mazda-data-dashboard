"""GET /api/garage: one car's headline figures for the "All cars" page (PLAN.md M32)."""

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mazda_dash.alerts import evaluate
from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]


@pytest.fixture(scope="module")
def dbs(tmp_path_factory):
    root = tmp_path_factory.mktemp("garage")
    out = {}
    for pid, profile in PROFILES.items():
        data = root / pid
        generate(data, profile=profile)
        db = root / f"{pid}.duckdb"
        model_dir = REPO / "config" / "models" / pid
        ingest(data, db, model_dir / "codes", data / "settings.yaml")
        evaluate(db, model_dir / "alerts.yaml")
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


def test_the_card_is_built_from_the_overview_the_oil_countdown_and_the_car_warnings(
    dbs,
):
    g = get(dbs["cx5"], "/api/garage")
    assert g["has_data"] and g["vin"] == "SAMPLEVIN00000001"
    # the 30 days up to the newest day with data
    assert (g["from_day"], g["to_day"]) == ("2026-06-01", "2026-06-30")
    o = get(dbs["cx5"], "/api/overview", **{"from": g["from_day"], "to": g["to_day"]})
    assert g["km_last_30_days"] == o["km_in_range"] and g["km_last_30_days"] > 500
    assert (g["odometer_km"], g["odometer_at"], g["last_reading_at"]) == (
        o["odometer_km"],
        o["odometer_at"],
        o["data_to"],
    )
    assert (g["alerts_new"], g["active_faults"]) == (
        o["alerts_new"],
        o["active_faults"],
    )
    assert (g["fuel_level_pct"], g["range_km"]) == (
        o["status"]["fuel_level_pct"],
        o["status"]["range_km"],
    )
    oil = get(dbs["cx5"], "/api/maintenance/oil")
    assert (g["oil_remaining_km"], g["oil_read_at"]) == (
        oil["remaining_km"],
        oil["read_at"],
    )
    flags = get(dbs["cx5"], "/api/status/car-warnings")["flags"]
    assert (
        g["car_warnings_on"]
        == [f["label"] for f in flags if f["is_on"]]
        == ["tire pressure, rear left"]
    )


def test_a_car_without_the_oil_countdown_has_none(dbs):
    g = get(dbs["cx60"], "/api/garage")
    assert g["oil_remaining_km"] is None and g["oil_read_at"] is None
    assert g["vin"] == "SAMPLEVIN00000002" and g["to_day"] == "2026-07-31"
    assert g["car_warnings_on"] == ["tire pressure, front left"]


def test_the_distance_never_starts_before_the_first_day(data_dir, tmp_path):
    ingest(
        data_dir,
        tmp_path / "short.duckdb",
        REPO / "config" / "models" / "cx5" / "codes",
    )
    g = get(tmp_path / "short.duckdb", "/api/garage")
    span = get(tmp_path / "short.duckdb", "/api/span")
    first, last = (
        date.fromisoformat(span["first_day"]),
        date.fromisoformat(span["last_day"]),
    )
    assert g["to_day"] == span["last_day"]
    assert g["from_day"] == max(first, last - timedelta(days=29)).isoformat()
    # a window that reaches back before the first day is cut at the first day
    short = tmp_path / "tiny"
    short.mkdir()
    for name in ("all-rts-24pf_rts-24pf.csv",):
        (short / name).write_text((data_dir / name).read_text())
    ingest(
        short, tmp_path / "tiny.duckdb", REPO / "config" / "models" / "cx5" / "codes"
    )
    tiny = get(tmp_path / "tiny.duckdb", "/api/garage")
    tiny_span = get(tmp_path / "tiny.duckdb", "/api/span")
    assert tiny["from_day"] == tiny_span["first_day"]


def test_a_database_without_data_says_so(tmp_path):
    empty = tmp_path / "e"
    empty.mkdir()
    ingest(
        empty, tmp_path / "empty.duckdb", REPO / "config" / "models" / "cx5" / "codes"
    )
    g = get(tmp_path / "empty.duckdb", "/api/garage")
    assert g["has_data"] is False
    assert g["vin"] is None and g["alerts_new"] == 0 and g["car_warnings_on"] == []


def test_the_card_follows_the_chosen_model(dbs, monkeypatch):
    monkeypatch.setenv("MAZDA_ROOT", str(REPO))
    monkeypatch.delenv("MAZDA_DB", raising=False)
    # the real databases may not exist in CI: an unknown model is the contract here
    r = TestClient(app).get("/api/garage", params={"model": "nope"})
    assert r.status_code == 404


def bare_db(tmp_path):
    """The CX-5 sample ingested with settings that set no fuel price."""
    bare = tmp_path / "bare-settings.yaml"
    bare.write_text("car_timezone: Europe/Lisbon\n")
    data = tmp_path / "bare-data"
    generate(data, profile=PROFILES["cx5"])
    db = tmp_path / "bare.duckdb"
    ingest(data, db, REPO / "config" / "models" / "cx5" / "codes", bare)
    return db


def test_fuel_and_cost_are_the_overviews_figures_for_the_same_window(dbs):
    g = get(dbs["cx5"], "/api/garage")
    o = get(dbs["cx5"], "/api/overview", **{"from": g["from_day"], "to": g["to_day"]})
    km = o["km_in_range"]
    assert g["l_per_100km_30d"] == pytest.approx(o["l_per_100km_in_range"], abs=0.005)
    assert g["fuel_l_30d"] == pytest.approx(
        km * o["l_per_100km_in_range"] / 100, abs=0.05
    )
    assert g["cost_per_100km_30d"] == pytest.approx(
        o["cost_per_100km_in_range"], abs=0.005
    )
    assert g["fuel_cost_30d"] == pytest.approx(
        km * o["cost_per_100km_in_range"] / 100, abs=0.005
    )
    assert g["currency"] == "EUR" == o["currency"]


def test_the_card_agrees_with_trends_when_the_window_is_a_whole_month(dbs):
    """The CX-5 sample ends on 30 June, so its 30 days are exactly June: the monthly figures must say the same."""
    g = get(dbs["cx5"], "/api/garage")
    june = {m["month"]: m for m in get(dbs["cx5"], "/api/trends/monthly")}["2026-06"]
    assert (g["from_day"], g["to_day"]) == ("2026-06-01", "2026-06-30")
    assert g["fuel_cost_30d"] == june["fuel_cost_est"]
    assert g["cost_per_100km_30d"] == june["cost_per_100km"]
    assert g["l_per_100km_30d"] == june["l_per_100km"]
    assert g["fuel_l_30d"] == june["fuel_l_est"]


def test_each_car_has_its_own_currency_and_prices(dbs):
    cx60 = get(dbs["cx60"], "/api/garage")
    assert cx60["currency"] == "EUR" and cx60["cost_per_100km_30d"] == pytest.approx(
        cx60["l_per_100km_30d"] * 1.79, abs=0.02
    )


def test_without_a_fuel_price_there_are_litres_but_no_cost(tmp_path):
    g = get(bare_db(tmp_path), "/api/garage")
    assert g["fuel_l_30d"] > 0 and g["l_per_100km_30d"] > 0
    assert (
        g["fuel_cost_30d"] is None
        and g["cost_per_100km_30d"] is None
        and g["currency"] is None
    )


def test_a_car_without_consumption_in_the_window_has_none(tmp_path):
    empty = tmp_path / "e2"
    empty.mkdir()
    ingest(
        empty, tmp_path / "empty2.duckdb", REPO / "config" / "models" / "cx5" / "codes"
    )
    g = get(tmp_path / "empty2.duckdb", "/api/garage")
    assert (
        g["fuel_l_30d"] is None
        and g["l_per_100km_30d"] is None
        and g["fuel_cost_30d"] is None
    )
