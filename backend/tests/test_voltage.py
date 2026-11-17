"""Battery voltage in the freeze frames (PLAN.md M68): GET /api/dtcs/frame-voltage."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.api.voltage import frame_voltage, theil_sen
from mazda_dash.ingest import ingest
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
T0 = datetime(2026, 4, 1, 9)


def frame(
    at,
    volts,
    ambient=20.0,
    rpm=800.0,
    since=600.0,
    soc=70.0,
    signal="Main_ECU_Voltage_Supply",
):
    return (
        at,
        {
            signal: volts,
            "Ambient_Air_Temperature": ambient,
            "Engine_RPM": rpm,
            "Time_Since_Engine_Start": since,
            "SOC_StateOfCharge": soc,
        },
    )


def fake_db(frames, faults=("U0001",)):
    """A stand-in for v_frame_signals: every frame recorded for each of ``faults`` (same moment, same values)."""
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE v_frame_signals (ecu VARCHAR, dtc_code VARCHAR, record_number VARCHAR, snapshot_at TIMESTAMP, "
        "signal VARCHAR, value_num DOUBLE, triggered_at TIMESTAMP)"
    )
    for at, values in frames:
        for code in faults:
            for signal, v in values.items():
                if v is not None:
                    con.execute(
                        "INSERT INTO v_frame_signals VALUES ('BCM', ?, '01', ?, ?, ?, ?)",
                        [code, at, signal, v, at],
                    )
    return con


def declining(n=20, per_30_days=-0.15, temp_effect=-0.02):
    """Running frames every 5 days: 13.8 V falling `per_30_days`, plus `temp_effect` volts per degree."""
    out = []
    for i in range(n):
        ambient = 10.0 + (i * 7) % 20  # temperatures moving up and down
        volts = (
            13.8
            + per_30_days * (5 * i) / 30
            + temp_effect * (ambient - 20)
            + (0.05 if i % 3 == 0 else -0.04)
        )
        out.append(
            frame(T0 + timedelta(days=5 * i, hours=i % 5), round(volts, 3), ambient)
        )
    return out


def group(answer, state):
    return next(g for g in answer.groups if g.state == state)


def test_frames_are_one_per_moment_and_kept_apart_by_engine_state():
    got = frame_voltage(
        fake_db(
            [
                frame(T0, 14.1),
                frame(T0 + timedelta(days=1), 12.6, rpm=0, since=0),
                frame(
                    T0 + timedelta(days=2), 11.9, since=8
                ),  # 8 s after a start: the starter pulls it down
                frame(T0 + timedelta(days=3), None),  # no voltage at all: left out
            ],
            faults=("U0001", "U0002", "U0003"),  # one moment, three faults: one frame
        )
    )
    assert [(f.state, f.voltage) for f in got.frames] == [
        ("running", 14.1),
        ("off", 12.6),
        ("starting", 11.9),
    ]
    assert (group(got, "running").frames, group(got, "off").frames) == (1, 1)


def test_the_other_voltage_signal_is_used_when_the_main_one_is_missing():
    got = frame_voltage(fake_db([frame(T0, 13.9, signal="ECU_Power_Voltage")]))
    assert got.frames[0].voltage == 13.9


def test_nothing_is_estimated_without_enough_frames_days_and_span():
    few = frame_voltage(fake_db(declining(n=8)))
    assert (
        not group(few, "running").enough and group(few, "running").per_30_days is None
    )
    one_day = [frame(T0 + timedelta(minutes=i), 13.5 + i / 100) for i in range(20)]
    assert not group(frame_voltage(fake_db(one_day)), "running").enough
    short = [frame(T0 + timedelta(days=2 * i), 13.5) for i in range(20)]  # 38 days
    assert not group(frame_voltage(fake_db(short)), "running").enough


def test_a_slow_decline_is_found_through_temperature_swings():
    g = group(frame_voltage(fake_db(declining())), "running")
    assert g.enough and g.frames == 20 and g.days == 20
    assert g.per_degree == pytest.approx(
        -0.02, abs=0.02
    )  # the swings partly follow time, as real ones can
    assert g.per_30_days == pytest.approx(-0.15, abs=0.04)
    assert g.flat is False and g.change_at is None  # gradual: no step


def test_a_steady_voltage_is_about_flat():
    g = group(frame_voltage(fake_db(declining(per_30_days=0.0))), "running")
    assert g.enough and g.flat is True


def test_a_step_is_found_as_a_change():
    frames = [
        frame(
            T0 + timedelta(days=5 * i),
            13.9 + (0.03 if i % 2 else -0.03) - (0.6 if i >= 10 else 0),
        )
        for i in range(20)
    ]
    g = group(frame_voltage(fake_db(frames)), "running")
    assert g.change_at == (T0 + timedelta(days=50)).astimezone() or g.change_at.replace(
        tzinfo=None
    ) == T0 + timedelta(days=50)
    assert g.change_before - g.change_after == pytest.approx(0.6, abs=0.05)


def test_theil_sen_by_hand():
    assert theil_sen([0, 1, 2, 3, 4], [0, 2, 4, 6, 100], 1) == pytest.approx(
        2.0
    )  # one wild point barely moves it
    assert theil_sen([0, 1], [0, 1], 5) is None


def test_no_frames():
    got = frame_voltage(fake_db([]))
    assert got.frames == [] and all(g.frames == 0 and not g.enough for g in got.groups)


@pytest.fixture(scope="module")
def samples(tmp_path_factory):
    root = tmp_path_factory.mktemp("voltage")
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
        r = TestClient(app).get("/api/dtcs/frame-voltage")
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def test_the_cx60_sample_shows_its_planted_decline_and_the_cx5_has_too_few(samples):
    running = next(g for g in get(samples["cx60"])["groups"] if g["state"] == "running")
    decline = PROFILES["cx60"].frame_voltage_decline
    assert running["enough"] and running["per_30_days"] == pytest.approx(
        -decline, abs=0.05
    )
    assert not any(g["enough"] for g in get(samples["cx5"])["groups"])
