"""When the car measured the tire pressures: time zone conversion, folding repeats, stale, alert (M19)."""

import itertools
import os
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.alerts import evaluate
from mazda_dash.alerts.config import AlertsConfig
from mazda_dash.alerts.engine import run_alerts
from mazda_dash.api.app import app
from mazda_dash.contract import (
    CLOCK_SIGNALS,
    TIRE_CLOCK_EDGE_CASES,
    add_tire_clock_snapshots,
)
from mazda_dash.ingest import ingest
from mazda_dash.model.settings import load_settings
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config"
T0 = datetime(2026, 5, 1, 12, 0)


@pytest.fixture
def con(data_dir, tmp_path):
    """A database whose settings are the repo's (Europe/Lisbon, stale after 6 h)."""
    db = tmp_path / "t.duckdb"
    ingest(data_dir, db, CONFIG / "codes")
    con = duckdb.connect(str(db))
    yield con
    con.close()


_unique = itertools.count()


def converted(con, parts, **kw):
    """The UTC time (as text) the view makes of one local clock reading, on a snapshot of its own."""
    at = T0 + timedelta(days=100 + next(_unique))
    (time,) = add_tire_clock_snapshots(con, [parts], at, **kw)
    return con.execute(
        "SELECT CAST(measured_at AS VARCHAR) FROM v_tire_snapshots WHERE created_at = ?",
        [time],
    ).fetchone()[0]


# ------------------------------------------------------ time zone conversion


def test_summer_and_winter_local_times_become_utc(con):
    assert converted(con, (2026, 6, 13, 0, 1)) == "2026-06-12 23:01:00"  # WEST = UTC+1
    assert converted(con, (2026, 12, 13, 0, 1)) == "2026-12-13 00:01:00"  # WET = UTC+0


def test_clock_changes(con):
    """Lisbon: clocks go forward 01:00 -> 02:00 (29 Mar) and back 02:00 -> 01:00 (25 Oct). A local time
    that does not exist or happens twice is resolved by DuckDB's ICU, identically in Python and in the
    browser engine (the goldens check that): this pins what it does."""
    assert converted(con, (2026, 3, 29, 0, 30)) == "2026-03-29 00:30:00"
    assert (
        converted(con, (2026, 3, 29, 1, 30)) == "2026-03-29 01:30:00"
    )  # does not exist
    assert (
        converted(con, (2026, 3, 29, 2, 30)) == "2026-03-29 01:30:00"
    )  # already summer time
    assert (
        converted(con, (2026, 10, 25, 0, 30)) == "2026-10-24 23:30:00"
    )  # still summer time
    assert (
        converted(con, (2026, 10, 25, 1, 30)) == "2026-10-25 01:30:00"
    )  # happens twice: the later one
    assert converted(con, (2026, 10, 25, 2, 30)) == "2026-10-25 02:30:00"


def test_conversions_agree_with_the_python_time_zone_database(con):
    zone = ZoneInfo("Europe/Lisbon")
    for parts in [
        (2026, 1, 15, 8, 5),
        (2026, 7, 4, 23, 59),
        (2028, 2, 29, 12, 0),
        (2026, 3, 28, 12, 0),
    ]:
        local = datetime(*parts, tzinfo=zone)
        expected = local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        assert converted(con, parts) == str(expected)


@pytest.mark.parametrize(
    "parts",
    [
        (2027, 2, 29, 12, 0),  # not a leap year
        (2026, 2, 30, 10, 0),
        (2026, 13, 1, 0, 0),
        (2026, 5, 32, 0, 0),
        (2026, 5, 1, 24, 0),
        (2026, 5, 1, 12, 60),
        (0, 255, 255, 255, 255),  # the car's "unknown"
        (1999, 6, 1, 12, 0),
    ],
)
def test_impossible_or_unknown_clock_values_give_no_time(con, parts):
    assert converted(con, parts) is None


@pytest.mark.parametrize("part", range(5))
def test_a_part_flagged_invalid_gives_no_time(con, part):
    assert converted(con, (2026, 6, 13, 0, 1), invalid_part=part) is None


def test_all_edge_cases_produce_a_snapshot_row_each(con):
    times = add_tire_clock_snapshots(con, TIRE_CLOCK_EDGE_CASES, T0)
    n = con.execute(
        "SELECT count(*) FROM v_tire_snapshots WHERE created_at BETWEEN ? AND ?",
        [times[0], times[-1]],
    ).fetchone()[0]
    assert n == len(TIRE_CLOCK_EDGE_CASES) and len(CLOCK_SIGNALS) == 5


# ------------------------------------------------------ settings


def test_the_zone_comes_from_the_settings(con):
    con.execute(
        "UPDATE ref_settings SET value = 'America/New_York' WHERE key = 'car_timezone'"
    )
    assert (
        converted(con, (2026, 6, 13, 0, 1)) == "2026-06-13 04:01:00"
    )  # UTC-4 in summer
    con.execute(
        "UPDATE ref_settings SET value = 'Asia/Kolkata' WHERE key = 'car_timezone'"
    )
    assert (
        converted(con, (2026, 6, 13, 12, 0)) == "2026-06-13 06:30:00"
    )  # a half-hour zone


def test_without_settings_the_clock_is_taken_as_utc(con):
    con.execute("DELETE FROM ref_settings")
    assert converted(con, (2026, 6, 13, 0, 1)) == "2026-06-13 00:01:00"


def test_settings_are_validated(tmp_path):
    con = duckdb.connect()
    bad = tmp_path / "settings.yaml"
    bad.write_text("car_timezone: Mars/Olympus_Mons\n")
    with pytest.raises(ValueError, match="not a time zone name"):
        load_settings(con, bad)
    bad.write_text("tire_stale_hours: 0\n")
    with pytest.raises(ValueError, match="above 0"):
        load_settings(con, bad)
    bad.write_text("car_timezon: Europe/Lisbon\n")
    with pytest.raises(ValueError, match="unknown setting"):
        load_settings(con, bad)
    assert load_settings(con, None) == {"car_timezone": "UTC", "tire_stale_hours": "6"}


# ------------------------------------------------------ readings


def snap(con, at, measured, kpa=(240, 240, 240, 240), signals=CLOCK_SIGNALS):
    """A status snapshot at `at` (UTC) saying the tires were measured at `measured` (Lisbon local parts)."""
    parts = dict(zip(signals, measured, strict=True)) if measured else {}
    values = parts | dict(
        zip(
            ("fltprsdispkp", "frtprsdispkp", "rltprsdispkp", "rrtprsdispkp"),
            kpa,
            strict=True,
        )
    )
    for signal, value in values.items():
        con.execute(
            "INSERT INTO signal_readings VALUES ('rts', 'V', 'x', ?, NULL, ?, ?, ?, true)",
            [at, signal, str(value), value],
        )


def test_snapshots_repeating_a_measurement_are_one_reading_with_both_ages(con):
    m = (2026, 6, 13, 9, 0)  # = 08:00 UTC
    snap(con, datetime(2026, 6, 13, 8, 10), m)
    snap(con, datetime(2026, 6, 13, 11, 0), m)
    snap(con, datetime(2026, 6, 13, 15, 30), m)
    (row,) = con.execute(
        "SELECT reading_at, time_known, snapshots, age_minutes, last_age_minutes, stale "
        "FROM v_tire_readings WHERE reading_at = TIMESTAMP '2026-06-13 08:00:00'"
    ).fetchall()
    assert row == (
        datetime(2026, 6, 13, 8, 0),
        True,
        3,
        10.0,
        450.0,
        True,
    )  # 7.5 h old when last seen > 6 h


def test_a_fresh_measurement_is_not_stale_and_the_limit_is_a_setting(con):
    snap(con, datetime(2026, 6, 13, 12, 0), (2026, 6, 13, 9, 0))  # 08:00 UTC: 4 h old
    q = "SELECT stale FROM v_tire_snapshots WHERE created_at = TIMESTAMP '2026-06-13 12:00:00'"
    assert con.execute(q).fetchone() == (False,)
    con.execute("UPDATE ref_settings SET value = '3' WHERE key = 'tire_stale_hours'")
    assert con.execute(q).fetchone() == (True,)


def test_snapshots_without_a_measurement_time_are_their_own_readings(con):
    snap(con, datetime(2026, 6, 14, 8, 0), None)
    snap(con, datetime(2026, 6, 14, 9, 0), None)
    rows = con.execute(
        "SELECT reading_at, time_known, snapshots, age_minutes, stale FROM v_tire_readings "
        "WHERE reading_at >= TIMESTAMP '2026-06-14' ORDER BY reading_at"
    ).fetchall()
    assert rows == [
        (datetime(2026, 6, 14, 8, 0), False, 1, None, None),
        (datetime(2026, 6, 14, 9, 0), False, 1, None, None),
    ]


def test_snapshots_without_pressures_are_not_readings(con):
    add_tire_clock_snapshots(con, [(2026, 6, 20, 10, 0)], datetime(2026, 6, 20, 9, 0))
    con.execute("DELETE FROM signal_readings WHERE signal LIKE '%prsdispkp'")
    assert con.execute("SELECT count(*) FROM v_tire_readings").fetchone() == (0,)


# ------------------------------------------------------ alert


def cfg(**rule):
    return AlertsConfig.model_validate(
        {"lookback_days": 400, "rules": {"low_tire_pressure": rule} if rule else {}}
    )


def low_alerts(created):
    return [c for c in created if c.rule == "low_tire_pressure"]


def test_one_low_measurement_seen_in_several_snapshots_is_one_alert(con):
    m = (2026, 6, 13, 9, 0)  # 08:00 UTC
    for hour in (8, 11, 15):
        snap(con, datetime(2026, 6, 13, hour, 10), m, kpa=(240, 240, 180, 240))
    (alert,) = low_alerts(run_alerts(con, cfg()))
    assert alert.dedup_key == "low_tire_pressure:rear left:2026-06-13"
    assert alert.occurred_at == datetime(
        2026, 6, 13, 8, 0
    )  # when it was measured, not first seen
    assert low_alerts(run_alerts(con, cfg())) == []


def test_the_alert_day_follows_the_measurement_not_the_snapshot(con):
    snap(
        con,
        datetime(2026, 6, 14, 0, 10),
        (2026, 6, 14, 0, 50),
        kpa=(240, 240, 240, 150),
    )  # measured 23:50 UTC on the 13th
    (alert,) = low_alerts(run_alerts(con, cfg()))
    assert alert.dedup_key == "low_tire_pressure:rear right:2026-06-13"


# ------------------------------------------------------ API and sample data


def api(db):
    os.environ["MAZDA_DB"] = str(db)
    return TestClient(app)


@pytest.fixture(scope="module")
def demo_db(tmp_path_factory):
    root = tmp_path_factory.mktemp("tires-sample")
    generate(root / "data")
    db = root / "demo.duckdb"
    ingest(root / "data", db, CONFIG / "codes")
    evaluate(db, CONFIG / "alerts.yaml")
    return db


def test_the_sample_has_old_and_missing_measurements(demo_db):
    readings = api(demo_db).get("/api/status/tires").json()
    assert len(readings) > 150
    assert all(r["reading_at"].endswith("Z") for r in readings)
    stale = [r for r in readings if r["stale"]]
    unknown = [r for r in readings if not r["time_known"]]
    folded = [r for r in readings if r["snapshots"] > 1]
    assert 5 <= len(stale) < 40  # snapshots after the car stood still for hours
    assert len(unknown) == 1 and unknown[0]["age_minutes"] is None
    assert folded and all(r["last_age_minutes"] >= r["age_minutes"] for r in folded)
    fresh = [
        r for r in readings if r["age_minutes"] is not None and r["age_minutes"] < 60
    ]
    assert len(fresh) > 100


def test_overview_status_says_when_the_tires_were_measured(demo_db):
    s = api(demo_db).get("/api/overview").json()["status"]
    assert s["tire_measured_at"].endswith("Z") and 0 < s["tire_age_minutes"] < 60
    assert s["tire_stale"] is False
    # a period ending before the newest data gives that period's last snapshot
    early = (
        api(demo_db).get("/api/overview", params={"to": "2026-03-10"}).json()["status"]
    )
    assert early["tire_measured_at"] < s["tire_measured_at"]


def test_the_tires_endpoint_follows_the_period(demo_db):
    client = api(demo_db)
    all_time = client.get("/api/status/tires").json()
    march = client.get(
        "/api/status/tires", params={"from": "2026-03-01", "to": "2026-03-31"}
    ).json()
    assert 0 < len(march) < len(all_time)
    assert all(r["reading_at"].startswith("2026-03") for r in march)
    assert client.get("/api/status/tires", params={"from": "2031-01-01"}).json() == []


def test_the_sample_still_raises_the_low_pressure_alert_once(demo_db):
    con = duckdb.connect(str(demo_db), read_only=True)
    rows = con.execute(
        "SELECT dedup_key FROM alerts WHERE rule = 'low_tire_pressure'"
    ).fetchall()
    con.close()
    assert len(rows) >= 1 and all("rear left" in r[0] for r in rows)


# ------------------------------------------------------ the time zone check (make timezone)


def test_the_zone_check_accepts_the_right_zone_and_rejects_wrong_ones(demo_db):
    from mazda_dash.timezone_check import check

    right = check(demo_db, "Europe/Lisbon")
    assert right["fits"] and right["negative"] == 0 and right["readings"] > 150
    assert 0 < right["median_age"] < 60
    assert "Europe/Lisbon" in right["suggestions"]
    utc = check(
        demo_db, "UTC"
    )  # the demo clock runs an hour ahead of UTC in summer: measurements in the future
    assert not utc["fits"] and utc["negative"] > 100
    assert not check(demo_db, "America/New_York")[
        "fits"
    ]  # hours too late: the readings would be future dated or ancient
    assert not check(demo_db, "Asia/Tokyo")[
        "fits"
    ]  # nine hours too early: measurements look hours old
    assert "Asia/Tokyo" not in utc["suggestions"]


def test_the_zone_check_groups_what_fits_by_clock_offset(demo_db):
    from mazda_dash.timezone_check import (
        candidate_zones,
        check,
        clock_readings,
        suggestion_groups,
    )

    con = duckdb.connect(str(demo_db), read_only=True)
    readings = clock_readings(con)
    con.close()
    fitting = check(demo_db, "Europe/Lisbon")["suggestions"]
    labels = {label for label, _ in suggestion_groups(readings, fitting)}
    assert labels == {
        "UTC+00:00 at first, UTC+01:00 at last",
        "UTC+01:00",
    }  # the demo data spans the March clock change
    assert (
        "Europe/Lisbon"
        in dict(suggestion_groups(readings, fitting))[
            "UTC+00:00 at first, UTC+01:00 at last"
        ]
    )
    assert len(candidate_zones()) > 300 and not any(
        z.startswith("Etc/") for z in candidate_zones()
    )
