"""What the values of some signals mean, as Mazda documents them per platform (PLAN.md M72)."""

from datetime import UTC
from pathlib import Path
from zoneinfo import ZoneInfo

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.ingest.schema import init_schema
from mazda_dash.model import build_model
from mazda_dash.model.signal_values import STATES, read_values
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
SHIPPED = REPO / "config" / "platforms" / "24PF" / "signal_values.yaml"


@pytest.fixture(scope="module")
def dbs(tmp_path_factory):
    root = tmp_path_factory.mktemp("signals")
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


def get(db: Path, path: str, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get(path, params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def table(values: dict) -> dict:
    return {(v["signal"], v["value"]): (v["label"], v["state"]) for v in values}


# ------------------------------------------------------------------ the file


def test_the_shipped_file_reads_and_names_its_source():
    source, rows = read_values(SHIPPED)
    assert "24PF" in source and "20260408" in source
    assert {r[3] for r in rows} <= set(STATES)
    assert len({(r[0], r[1]) for r in rows}) == len(rows)


def test_the_two_lock_switches_count_the_other_way_round():
    meaning = {(s, v): label for s, v, label, _ in read_values(SHIPPED)[1]}
    assert meaning[("locklinkswdrv", 2.0)] == "Locked"
    assert meaning[("locklinkswdrv", 0.0)] == "Unlocked"
    assert meaning[("locklinkswpsngr", 0.0)] == "Locked"
    assert meaning[("locklinkswpsngr", 1.0)] == "Unlocked"


def test_not_available_and_reserved_say_nothing_and_failures_need_attention():
    state = {(s, v): st for s, v, _, st in read_values(SHIPPED)[1]}
    assert state[("fltyrepresswarn", 2.0)] == "unknown"
    assert state[("tpmsstatus", 3.0)] == "unknown"
    assert state[("locklinkswdrv", 3.0)] == "attention"
    assert state[("ocsstatus", 3.0)] == "attention"
    # the engine state is a fact, never a problem
    assert {st for (s, _), st in state.items() if s == "enginestate"} == {"info"}


@pytest.mark.parametrize(
    "body, error",
    [
        ("signals: {}\n", "exactly `source` and `signals`"),
        (
            "source: x\nsignals:\n  a:\n    1: {label: A, state: bad}\n",
            "state must be one of",
        ),
        (
            "source: x\nsignals:\n  a:\n    1: {label: A}\n",
            "exactly `label` and `state`",
        ),
        (
            "source: x\nsignals:\n  a:\n    one: {label: A, state: ok}\n",
            "not a whole number",
        ),
        ("source: x\nsignals:\n  a b:\n    1: {label: A, state: ok}\n", "one word"),
        (
            "source: ''\nsignals:\n  a:\n    1: {label: A, state: ok}\n",
            "where the meanings come from",
        ),
    ],
)
def test_a_broken_file_fails_loudly(tmp_path, body, error):
    path = tmp_path / "signal_values.yaml"
    path.write_text(body)
    with pytest.raises(ValueError, match=error):
        read_values(path)


# ------------------------------------------------------------- which model gets them


def build(codes_dir: Path, settings: Path | None = None) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    init_schema(con)
    build_model(con, codes_dir, settings)
    return con


def test_a_model_without_a_platform_gets_none():
    con = build(REPO / "config" / "models" / "cx60" / "codes")
    assert con.execute("SELECT count(*) FROM ref_signal_values").fetchone() == (0,)


def test_a_codes_folder_outside_the_config_gets_none(tmp_path):
    (tmp_path / "codes").mkdir()
    (tmp_path / "model.yaml").write_text("id: x\nname: X\nplatform: 24PF\n")
    con = build(tmp_path / "codes")
    assert con.execute("SELECT count(*) FROM ref_signal_values").fetchone() == (0,)


def test_settings_may_name_a_platform_only_for_a_model_that_has_none(tmp_path):
    settings = tmp_path / "settings.yaml"
    settings.write_text("platform: 24PF\n")
    con = build(REPO / "config" / "models" / "cx60" / "codes", settings)
    assert con.execute("SELECT count(*) FROM ref_signal_values").fetchone()[0] > 0
    with pytest.raises(ValueError, match="only for a model whose model.yaml has none"):
        build(REPO / "config" / "models" / "cx5" / "codes", settings)


def test_a_platform_without_a_file_gets_none(tmp_path):
    settings = tmp_path / "settings.yaml"
    settings.write_text("platform: 99XX\n")
    con = build(REPO / "config" / "models" / "cx60" / "codes", settings)
    assert con.execute("SELECT count(*) FROM ref_signal_values").fetchone() == (0,)


# ---------------------------------------------------------------------- the API


def test_the_route_gives_the_table_of_the_model(dbs):
    cx5 = get(dbs["cx5"], "/api/signals/values")
    assert cx5["platform"] == "24PF" and "24PF" in cx5["source"]
    assert table(cx5["values"])[("enginestate", 10.0)] == (
        "Running with stop-start on",
        "info",
    )
    keys = [(v["signal"], v["value"]) for v in cx5["values"]]
    assert keys == sorted(keys)
    # the CX-60 sample names the platform in its own settings (the demo); the real CX-60 config has none
    assert get(dbs["cx60"], "/api/signals/values")["platform"] == "24PF"


def test_a_value_documented_as_not_available_is_not_a_warning(tmp_path):
    con = build(REPO / "config" / "models" / "cx5" / "codes")
    con.execute(
        "INSERT INTO signal_readings VALUES "
        "('rts', 'V', 'x', TIMESTAMP '2026-06-01 10:00:00', NULL, 'fltyrepresswarn', '2', 2, true), "
        "('rts', 'V', 'x', TIMESTAMP '2026-06-01 10:00:00', NULL, 'frtyrepresswarn', '1', 1, true), "
        "('rts', 'V', 'x', TIMESTAMP '2026-06-01 10:00:00', NULL, 'oillevelwarning', '7', 7, true)"
    )
    on = dict(con.execute("SELECT flag, is_on FROM v_car_warning_readings").fetchall())
    # 2 = not available (unknown); 1 = low; 7 is not documented, so any non-zero still counts
    assert on == {
        "fltyrepresswarn": False,
        "frtyrepresswarn": True,
        "oillevelwarning": True,
    }
    # without documented values, any non-zero counts, as before M72
    plain = build(REPO / "config" / "models" / "cx60" / "codes")
    plain.execute(
        "INSERT INTO signal_readings VALUES "
        "('rts', 'V', 'x', TIMESTAMP '2026-06-01 10:00:00', NULL, 'fltyrepresswarn', '2', 2, true)"
    )
    assert plain.execute("SELECT is_on FROM v_car_warning_readings").fetchone() == (
        True,
    )


def test_the_seat_sensors_on_who_rides(dbs):
    assert get(dbs["cx5"], "/api/status/occupancy")["sensors"] == []
    o = get(dbs["cx60"], "/api/status/occupancy")
    seats = {s["seat"]: s for s in o["sensors"]}
    assert list(seats) == ["passenger", "rear_left", "rear_center", "rear_right"]
    # every seat's readings are the belted ones; the passenger's seat holds a bag on some trips without a belt
    assert all(s["readings"] == o["belted_readings"] for s in seats.values())
    assert seats["passenger"]["occupied_readings"] >= o["passenger_readings"]
    assert seats["rear_left"]["occupied_readings"] == o["rear_left_readings"]
    # the sample's rear centre sensor reports a malfunction in the last two days
    assert seats["rear_center"]["latest_label"] == "Malfunction"
    assert seats["rear_center"]["latest_state"] == "attention"
    assert seats["passenger"]["latest_state"] in {"ok", "info"}


def test_an_empty_period_has_no_seat_sensors(dbs):
    o = get(
        dbs["cx60"],
        "/api/status/occupancy",
        **{"from": "2031-01-01", "to": "2031-01-02"},
    )
    assert o["sensors"] == []


def test_the_engine_state_and_the_alarm_reach_the_overview_and_the_day(dbs):
    ov = get(dbs["cx5"], "/api/overview")
    assert ov["status"]["engine_state"] in {3.0, 10.0}
    day = get(dbs["cx5"], "/api/day")
    status = [e for e in day["entries"] if e["kind"] == "status"]
    assert status and all(e["engine_state"] in {3.0, 10.0} for e in status)
    profile = PROFILES["cx5"]
    when, status, reason = profile.alarms[0]
    local = when.replace(tzinfo=UTC).astimezone(ZoneInfo(profile.timezone)).date()
    alarms = [
        e
        for e in get(dbs["cx5"], "/api/day", date=local.isoformat())["entries"]
        if e["kind"] == "alarm"
    ]
    assert (alarms[0]["alarm_status"], alarms[0]["alarm_reason"]) == (status, reason)
