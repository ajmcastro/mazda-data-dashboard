"""GET /api/status/unusual: the status and door reports least like the car's other reports (PLAN.md M64)."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.ingest.schema import init_schema
from mazda_dash.model import build_model
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
CODES = REPO / "config" / "models" / "cx5" / "codes"
T0 = datetime(2026, 6, 1, 9, 0)  # 10:00 in Lisbon (summer time)
TIRES = ("fltprsdispkp", "frtprsdispkp", "rltprsdispkp", "rrtprsdispkp")
DOORS = {"door_driver": "drstatdrv", "trunk": "drstattrnklg", "hazard": "hazardsw"}


def status(at, fuel=50.0, odo=1000.0, tires=(240, 240, 240, 240), invalid=()):
    """One remote-status report: (created_at, [(signal, value, valid)])."""
    signals = [
        ("fuelsegementdactl", fuel),
        ("ododispvalue", odo),
        *zip(TIRES, tires, strict=True),
    ]
    return ("rts", at, [(s, v, s not in invalid) for s, v in signals])


def doors(at, **open_):
    signals = [("drstatdrv", 0), ("drstatpsngr", 0), ("drstatrl", 0), ("drstatrr", 0), ("drstattrnklg", 0),
               ("drstathood", 0), ("hazardsw", 0)]  # fmt: skip
    wanted = {DOORS[k]: v for k, v in open_.items()}
    return ("vis", at, [(s, wanted.get(s, v), True) for s, v in signals])


def daily(n=40, start=T0, **kw):
    """A status report every day at the same hour, the car driven 20 km a day, the tank falling slowly."""
    return [
        status(start + timedelta(days=i), fuel=80 - i * 0.5, odo=1000 + 20 * i, **kw)
        for i in range(n)
    ]


def make_db(tmp_path: Path, reports, zone="Europe/Lisbon") -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    db = tmp_path / "t.duckdb"
    (tmp_path / "settings.yaml").write_text(f"car_timezone: {zone}\n")
    con = duckdb.connect(str(db))
    init_schema(con)
    for source, at, signals in reports:
        con.executemany(
            "INSERT INTO signal_readings (source, vin, created_at, signal, value, value_num, valid) "
            "VALUES (?, 'V', ?, ?, ?, ?, ?)",
            [[source, at, s, str(v), float(v), ok] for s, v, ok in signals],
        )
    build_model(con, CODES, tmp_path / "settings.yaml")
    con.close()
    return db


def get(db: Path, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get("/api/status/unusual", params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def reasons(got):
    return [
        (r["local"], r["kind"], x["feature"])
        for r in got["reports"]
        for x in r["reasons"]
    ]


def test_a_regular_car_has_nothing_unusual_and_no_division_by_zero(tmp_path):
    got = get(make_db(tmp_path, daily()))
    assert got["reports"] == [] and got["enough_status"] is True
    assert (
        got["status_reports"] == 40
        and got["doors_reports"] == 0
        and got["enough_doors"] is False
    )


def test_fewer_than_thirty_reports_are_not_scored(tmp_path):
    reports = daily(20)
    reports.append(
        status(T0 + timedelta(days=20, hours=17), tires=(240, 240, 240, 180))
    )
    got = get(make_db(tmp_path, reports))
    assert (
        got["reports"] == []
        and got["enough_status"] is False
        and got["min_reports"] == 30
    )


def test_a_fuel_drop_while_parked_is_found_but_not_a_fill_up_or_driving(tmp_path):
    reports = daily()
    last = T0 + timedelta(days=39)
    # parked: the odometer does not move. Ten pairs of normal noise first, then the drop and a fill-up
    for i in range(10):
        reports.append(
            status(last + timedelta(hours=i + 1), fuel=60.5 - (i % 2) * 0.5, odo=1780)
        )
    reports.append(
        status(last + timedelta(hours=12), fuel=54, odo=1780)
    )  # fell 6 points while parked
    reports.append(
        status(last + timedelta(hours=13), fuel=95, odo=1780)
    )  # a fill-up: a rise
    got = get(make_db(tmp_path, reports))
    (r,) = got["reports"]
    (x,) = r["reasons"]
    assert (r["kind"], x["feature"], x["value"]) == ("status", "fuel_drop_parked", 6.0)
    assert x["z"] >= 3.5 and x["usual_low"] is not None


def test_a_wide_tire_spread_is_found_with_the_usual_range(tmp_path):
    reports = daily(tires=(240, 240, 230, 240))  # a spread of 10 every day
    reports.append(
        status(T0 + timedelta(days=40), odo=1800, tires=(240, 240, 210, 240))
    )
    reports.append(
        status(T0 + timedelta(days=41), odo=1820, tires=(240, 240, 225, 240))
    )  # 15: not unusual
    got = get(make_db(tmp_path, reports))
    (r,) = got["reports"]
    (x,) = r["reasons"]
    # the spread never varied, so its scale is the 5 kPa floor: (30 - 10) / 5 = 4
    assert (x["feature"], x["value"], x["z"], x["usual_low"], x["usual_high"]) == (
        "tire_spread",
        30.0,
        4.0,
        10.0,
        10.0,
    )


def test_a_value_flagged_invalid_is_never_scored(tmp_path):
    reports = daily(tires=(240, 240, 230, 240))
    reports.append(
        status(
            T0 + timedelta(days=40),
            odo=1800,
            tires=(240, 240, 100, 240),
            invalid=("rltprsdispkp",),
        )
    )
    assert get(make_db(tmp_path, reports))["reports"] == []


def test_a_rare_hour_is_in_the_cars_local_time(tmp_path):
    reports = daily(100)
    reports.append(status(datetime(2026, 9, 20, 2, 14), odo=4000))  # 03:14 in Lisbon
    got = get(make_db(tmp_path, reports))
    assert reasons(got) == [("2026-09-20 03:14", "status", "hour")]
    (x,) = got["reports"][0]["reasons"]
    assert x["value"] == 3 and x["share_pct"] == 1.0
    # the same moment in UTC is an hour that is just as rare
    assert reasons(get(make_db(tmp_path / "utc", reports, zone="UTC"))) == [
        ("2026-09-20 02:14", "status", "hour")
    ]


def test_a_rarely_open_door_or_the_hazard_lights_are_found_never_all_closed(tmp_path):
    shut = [doors(T0 + timedelta(days=i, minutes=2)) for i in range(150)]
    rare = [
        doors(T0 + timedelta(days=150, minutes=2), door_driver=1),
        doors(T0 + timedelta(days=151, minutes=2), hazard=1),
    ]
    trunk = [
        doors(T0 + timedelta(days=152 + i, minutes=2), trunk=1) for i in range(5)
    ]  # 5 of 157: usual
    got = get(make_db(tmp_path, shut + rare + trunk))
    assert [
        (r["reasons"][0]["feature"], r["reasons"][0]["label"]) for r in got["reports"]
    ] == [
        ("open", "hazard"),
        ("open", "door_driver"),
    ]


def test_the_period_lists_reports_but_what_is_usual_comes_from_all_the_data(tmp_path):
    reports = daily(tires=(240, 240, 230, 240))
    reports.append(
        status(T0 + timedelta(days=40), odo=1800, tires=(240, 240, 210, 240))
    )
    db = make_db(tmp_path, reports)
    assert len(get(db, **{"from": "2026-07-11", "to": "2026-07-11"})["reports"]) == 1
    early = get(db, to="2026-06-10")
    assert (
        early["reports"] == []
        and early["status_reports"] == 10
        and early["enough_status"] is True
    )


def test_reports_are_newest_first_with_every_reason(tmp_path):
    reports = daily(100, tires=(240, 240, 230, 240))
    reports.append(
        status(datetime(2026, 9, 20, 2, 14), odo=4000, tires=(240, 240, 200, 240))
    )
    reports.append(
        status(datetime(2026, 9, 21, 9, 0), odo=4020, tires=(240, 240, 205, 240))
    )
    got = get(make_db(tmp_path, reports))
    assert [r["local"] for r in got["reports"]] == [
        "2026-09-21 10:00",
        "2026-09-20 03:14",
    ]
    assert [x["feature"] for x in got["reports"][1]["reasons"]] == [
        "hour",
        "tire_spread",
    ]


@pytest.fixture(scope="module")
def samples(tmp_path_factory):
    root = tmp_path_factory.mktemp("unusual")
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


@pytest.mark.parametrize("pid", sorted(PROFILES))
def test_both_sample_cars_are_scored(samples, pid):
    got = get(samples[pid])
    assert got["enough_status"] and got["enough_doors"]
    assert got["reports"], (
        "the sample data should have at least one unusual report to show"
    )
    for r in got["reports"]:
        assert r["reasons"] and r["kind"] in {"status", "doors"}


# ------------------------------------------------------------ the alert rule (off by default)


def alerts(db: Path, **rule):
    from mazda_dash.alerts.config import AlertsConfig
    from mazda_dash.alerts.engine import run_alerts

    cfg = AlertsConfig.model_validate(
        {"rules": {"unusual_report": rule}} if rule else {}
    )
    con = duckdb.connect(str(db))
    try:
        return [
            c
            for c in run_alerts(con, cfg, now=datetime(2026, 12, 1))
            if c.rule == "unusual_report"
        ]
    finally:
        con.close()


def test_the_alert_is_off_by_default_and_raised_once_per_reason(tmp_path):
    reports = daily(100, tires=(240, 240, 230, 240))
    reports.append(
        status(datetime(2026, 9, 9, 2, 14), odo=2980, tires=(240, 240, 200, 240))
    )  # 03:14 in Lisbon
    db = make_db(tmp_path, reports)
    assert alerts(db) == []
    found = alerts(db, enabled=True)
    assert sorted(c.dedup_key for c in found) == [
        "unusual_report:hour:3:20260909T021400",
        "unusual_report:tire_spread:40:20260909T021400",
    ]
    by_key = {c.dedup_key.split(":")[1]: c for c in found}
    assert by_key["hour"].title == "Unusual report at 03:14 (car's local time)"
    assert by_key["hour"].severity == "info"
    assert by_key["tire_spread"].detail == (
        "At 2026-09-09 03:14 (car's local time) the highest and lowest tire pressures were 40 kPa apart; "
        "usually 10 to 10 kPa. Unlike this car's other reports; a hint, not a diagnosis."
    )
    assert alerts(db, enabled=True) == []  # already raised


def test_the_alert_names_open_parts_and_a_fuel_drop(tmp_path):
    shut = [doors(T0 + timedelta(days=i, minutes=2)) for i in range(150)]
    reports = [
        *daily(),
        *shut,
        doors(T0 + timedelta(days=39, minutes=5), door_driver=1, hazard=1),
    ]
    last = T0 + timedelta(days=39)
    for i in range(10):
        reports.append(
            status(last + timedelta(hours=i + 1), fuel=60.5 - (i % 2) * 0.5, odo=1780)
        )
    reports.append(status(last + timedelta(hours=12), fuel=54, odo=1780))
    found = {
        c.dedup_key.split(":")[1]: c
        for c in alerts(make_db(tmp_path, reports), enabled=True)
    }
    assert found["open"].title == "Unusual report: driver door, hazard lights open"
    assert found["open"].dedup_key.startswith("unusual_report:open:door_driver+hazard:")
    assert (
        found["fuel_drop_parked"].title
        == "Unusual report: the fuel level fell 6 points while parked"
    )
    assert "usually it falls by 0 to 0.5 points" in found["fuel_drop_parked"].detail
