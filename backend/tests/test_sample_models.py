"""The second synthetic model (CX-60) is another car on purpose (PLAN.md M25)."""

import time
from datetime import datetime
from pathlib import Path

import duckdb
import pytest

from mazda_dash.alerts import evaluate
from mazda_dash.compat import compat_report
from mazda_dash.ingest import distinct_vins, find_files, ingest
from mazda_dash.models import load_registry
from mazda_dash.sample import CX5, CX60, PROFILES, generate
from mazda_dash.timezone_check import check

REPO = Path(__file__).parents[2]


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    """Both sample models ingested with their own configuration, as `make demo` does."""
    root = tmp_path_factory.mktemp("both")
    registry = load_registry(REPO)
    out = {}
    for profile in PROFILES.values():
        model = registry.get(profile.id)
        data, db = root / profile.id, root / f"{profile.id}.duckdb"
        generate(data, profile=profile)
        results = ingest(data, db, model.codes_dir)
        evaluate(db, model.alerts_path)
        out[profile.id] = (data, db, results, model)
    return out


def q(built, model, sql):
    con = duckdb.connect(str(built[model][1]), read_only=True)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_the_committed_sample_data_is_what_the_generator_writes(tmp_path):
    for profile in PROFILES.values():
        generate(tmp_path / profile.id, profile=profile)
        committed = REPO / "sample_data" / profile.id
        fresh = {p.name: p.read_bytes() for p in (tmp_path / profile.id).iterdir()}
        assert fresh == {p.name: p.read_bytes() for p in committed.iterdir()}


def test_both_models_ingest_every_kind_and_keep_to_their_own_vin(built):
    for model_id, profile in (("cx5", CX5), ("cx60", CX60)):
        _, db, results, _ = built[model_id]
        assert {k for k, *_ in results} == {
            "war",
            "dtc-h",
            "dtc-d",
            "dtc-ssr",
            "rts",
            "vis",
            "alt",
            "diag",
        }
        assert distinct_vins(db) == [profile.vin] * len(distinct_vins(db))
        assert set(distinct_vins(db)) == {profile.vin}


def test_the_platform_code_in_the_file_names_differs_and_ingestion_does_not_care(built):
    names = {m: {p.name for _, p in find_files(built[m][0])} for m in built}
    assert all("sample60" in n for n in names["cx60"]) and all(
        "sample60" not in n for n in names["cx5"]
    )
    assert (
        len(names["cx5"]) == 10 and len(names["cx60"]) == 9
    )  # three reports against two


def test_the_two_cars_differ(built):
    assert q(built, "cx5", "SELECT count(*) FROM diag_reports") == [(3,)]
    assert q(built, "cx60", "SELECT count(*) FROM diag_reports") == [(2,)]
    codes = {
        m: {r[0] for r in q(built, m, "SELECT DISTINCT code FROM warning_codes")}
        for m in built
    }
    assert codes["cx5"].isdisjoint(codes["cx60"])
    first = lambda m: q(
        built, m, "SELECT min(read_at), max(read_at) FROM v_odometer_readings"
    )[0]
    assert first("cx60")[0] > first("cx5")[0] and first("cx60")[1] > first("cx5")[1]
    faults = {
        m: {
            r[0]
            for r in q(
                built,
                m,
                "SELECT DISTINCT dtc_code FROM v_dtc_events WHERE dtc_code <> ''",
            )
        }
        for m in built
    }
    assert faults["cx5"].isdisjoint(faults["cx60"])


def test_the_diagnostic_tool_clock_is_read_with_its_own_offset(built):
    """The CX-60 report is written in UTC+0200 local time and must come back as the visit's UTC time."""
    taken = [
        r[0]
        for r in q(built, "cx60", "SELECT taken_at FROM diag_reports ORDER BY taken_at")
    ]
    assert taken == [when for when, _ in CX60.visits]
    assert taken[0] == datetime(2026, 6, 1, 10, 0)


def test_the_car_clock_zone_fits_each_model(built):
    for model_id, zone in (("cx5", "Europe/Lisbon"), ("cx60", "Europe/Berlin")):
        r = check(built[model_id][1], zone)
        assert r["fits"], (model_id, r)
    assert not check(built["cx60"][1], "Asia/Tokyo")["fits"]  # another zone does not
    assert q(
        built, "cx60", "SELECT value FROM ref_settings WHERE key = 'car_timezone'"
    ) == [("Europe/Berlin",)]


def test_alerts_follow_each_cars_data(built):
    expected = {
        "new_dtc",
        "recurring_dtc",
        "new_warning_code",
        "warning_spike",
        "burglar_alarm",
        "high_consumption",
        "low_tire_pressure",
    }
    rules = {
        m: {r[0] for r in q(built, m, "SELECT DISTINCT rule FROM alerts")}
        for m in built
    }
    assert expected <= rules["cx5"] and expected <= rules["cx60"]
    assert (
        "oil_change_due" in rules["cx5"] and "oil_change_due" not in rules["cx60"]
    )  # no countdown there
    text = " ".join(
        r[0] for r in q(built, "cx60", "SELECT title || detail FROM alerts")
    )
    assert (
        "$5F3" in text and "$4E9" not in text
    )  # its own new warning code, not the CX-5's


def test_the_leaking_tire_is_a_different_wheel(built):
    wheel = lambda m: q(
        built,
        m,
        "SELECT signal FROM signal_readings WHERE signal LIKE '%tyrepresswarn' AND value_num > 0 GROUP BY signal",
    )
    assert wheel("cx5") == [("rltyrepresswarn",)]
    assert wheel("cx60") == [("fltyrepresswarn",)]


def test_the_compatibility_report_lists_what_the_second_model_lacks(built):
    reports = {}
    for m in built:
        con = duckdb.connect(str(built[m][1]), read_only=True)
        reports[m] = compat_report(con)
        con.close()
    gone = {
        m: {e["signal"]: e["views"] for e in reports[m]["missing"]} for m in reports
    }
    assert (
        "remoildistk" not in gone["cx5"]
    )  # (the CX-5 sample lacks a few other signals the real car sends)
    belts = {
        "firstrowbuckledriver",
        "firstrowbucklepsngr",
        "rear_left_seatbelt_used",
        "rear_right_seatbelt_used",
    }
    # the CX-60 sample sends the belts (M37) and lacks the oil countdown; the CX-5 sample is the other way round
    assert set(gone["cx60"]) - set(gone["cx5"]) == {"remoildistk"}
    assert belts <= set(gone["cx5"]) and not belts & set(gone["cx60"])
    assert "v_oil_readings" in gone["cx60"]["remoildistk"]
    assert set(gone["cx5"]) - belts <= set(gone["cx60"])
    assert {"sample60_drivemode", "sample60_cabintemp"} <= set(
        reports["cx60"]["unread"]
    )
    assert not {"sample60_drivemode"} & set(reports["cx5"]["unread"])


@pytest.mark.parametrize("profile", list(PROFILES.values()), ids=lambda p: p.id)
def test_each_sample_model_does_not_depend_on_the_machines_time_zone(
    profile, tmp_path, monkeypatch
):
    def build(tz: str, name: str) -> dict[str, bytes]:
        monkeypatch.setenv("TZ", tz)
        time.tzset()
        generate(tmp_path / name, profile=profile)
        return {p.name: p.read_bytes() for p in sorted((tmp_path / name).iterdir())}

    try:
        utc = build("UTC", "utc")
        assert build("Pacific/Auckland", "nz") == utc
        assert build("America/New_York", "ny") == utc
    finally:
        monkeypatch.undo()
        time.tzset()
