"""The car's 128 warning-lamp bit flags: views, labels, hints, alert rule (M20)."""

import os
from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from mazda_dash.alerts import evaluate
from mazda_dash.alerts.config import AlertsConfig
from mazda_dash.alerts.engine import run_alerts
from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config"
T0 = datetime(
    2026, 6, 13, 8, 0
)  # the conftest warnings and fault are at 08:45 and 09:23 this day
BODY = "vdt_7_warningbody_1_30"
PT = "vdt_2_warningpt_1_23"
CONSTANT = "vdt_2_warningpt_1_0"


def add_flag(con, flag, values, start=T0, step=timedelta(days=1), valid=None):
    """Readings of a flag (plain column: no validity flag unless `valid` is given)."""
    times = []
    for i, v in enumerate(values):
        t = start + i * step if not isinstance(step, list) else start + step[i]
        times.append(t)
        con.execute(
            "INSERT INTO signal_readings VALUES ('rts', 'V', 'x', ?, NULL, ?, ?, ?, ?)",
            [t, flag, None if v is None else str(v), v, valid],
        )
    return times


def make_db(data_dir, tmp_path, labels=None):
    codes = tmp_path / "codes"
    codes.mkdir()
    if labels:
        (codes / "warning_flags.yaml").write_text(labels)
    db = tmp_path / "f.duckdb"
    ingest(data_dir, db, codes)
    return db


@pytest.fixture
def con(data_dir, tmp_path):
    con = duckdb.connect(str(make_db(data_dir, tmp_path)))
    yield con
    con.close()


# ------------------------------------------------------ views


def test_flags_that_never_change_are_invisible(con):
    add_flag(con, CONSTANT, [0, 0, 0, 0])
    add_flag(con, "vdt_7_warningbody_1_1", [1, 1, 1, 1])  # constant, even if on
    add_flag(con, BODY, [0, 1, 1, 0])
    assert con.execute("SELECT flag FROM v_warning_flags").fetchall() == [(BODY,)]
    assert con.execute(
        "SELECT DISTINCT flag FROM v_warning_flag_readings"
    ).fetchall() == [(BODY,)]


def test_summary_and_runs_of_a_flag(con):
    t = add_flag(
        con, BODY, [0, 1, 1, 0, 1, None]
    )  # the last reading is Invalid-like: NULL, ignored
    row = con.execute(
        "SELECT area, bit, readings, readings_on, pct_on, first_on_at, last_on_at, on_now, max_value, episodes "
        "FROM v_warning_flags"
    ).fetchone()
    assert row == ("body", 30, 5, 3, 60.0, t[1], t[4], True, 1.0, 2)
    assert con.execute(
        "SELECT started_at, last_on_at, readings, ongoing FROM v_warning_flag_episodes ORDER BY started_at"
    ).fetchall() == [(t[1], t[2], 2, False), (t[4], t[4], 1, True)]


def test_a_reading_flagged_invalid_is_ignored(con):
    add_flag(con, BODY, [0, 1, 0, 1], valid=True)
    add_flag(
        con, BODY, [1], start=T0 + timedelta(days=10), valid=False
    )  # Invalid: not a reading
    assert con.execute(
        "SELECT readings, readings_on FROM v_warning_flags"
    ).fetchone() == (4, 2)


def test_power_train_and_body_are_told_apart(con):
    add_flag(con, PT, [0, 1])
    add_flag(con, "vdt_7_warningbody_2_44", [0, 1])
    assert con.execute(
        "SELECT flag, area, bit FROM v_warning_flags ORDER BY flag"
    ).fetchall() == [
        (PT, "powertrain", 23),
        ("vdt_7_warningbody_2_44", "body", 44),
    ]


def test_first_set_on_the_day_of_a_diagnostic_report(con):
    # the fixture's diagnostic report was taken on 2026-10-15
    add_flag(con, PT, [0, 1], start=datetime(2026, 10, 14, 9, 0))
    add_flag(con, BODY, [0, 1], start=datetime(2026, 6, 12, 9, 0))
    got = dict(
        con.execute("SELECT flag, first_on_report_day FROM v_warning_flags").fetchall()
    )
    assert got == {PT: True, BODY: False}


# ------------------------------------------------------ labels and the unmapped list


LABELS = f"""{BODY}:
  title: Example lamp
  severity: warning
  notes: written by the test
"""


def test_labels_from_the_yaml_file_and_the_unmapped_list(data_dir, tmp_path):
    con = duckdb.connect(str(make_db(data_dir, tmp_path, LABELS)))
    add_flag(con, BODY, [0, 1, 0, 1])
    add_flag(con, PT, [0, 1, 1, 1])
    got = {
        r[0]: r[1:]
        for r in con.execute(
            "SELECT flag, title, severity, notes FROM v_warning_flags"
        ).fetchall()
    }
    assert got[BODY] == ("Example lamp", "warning", "written by the test")
    assert got[PT] == (None, "unknown", None)
    # only the flag without a meaning is unmapped; its count is the readings with it on
    assert con.execute(
        "SELECT code, occurrences FROM v_unmapped_codes WHERE kind = 'warning flag'"
    ).fetchall() == [(PT, 3)]


def test_the_labels_file_is_validated(data_dir, tmp_path):
    with pytest.raises(ValueError, match="unknown field"):
        make_db(data_dir, tmp_path, f"{BODY}:\n  titel: oops\n")


# ------------------------------------------------------ hints


def test_hints_rank_what_is_near_the_flag_when_it_is_on_but_not_when_it_is_off(
    data_dir, tmp_path
):
    db = make_db(data_dir, tmp_path)
    con = duckdb.connect(str(db))
    # The fixture has warnings $182 $21D $210 at 08:45 and $210 at 09:23, and the fault ADU C1681 at 08:45.
    # The flag is on at 08:50 and off at 09:00.
    add_flag(
        con, BODY, [1, 0], start=T0, step=[timedelta(minutes=50), timedelta(hours=1)]
    )
    con.close()  # the API opens its own connections
    os.environ["MAZDA_DB"] = str(db)
    client = TestClient(app)

    def hints(hours):
        return client.get(
            "/api/status/warning-flags/hints",
            params={"flag": BODY, "window_hours": hours},
        ).json()

    wide = hints(2)  # both readings see all of it: it says nothing about the flag
    assert (wide["on_readings"], wide["off_readings"]) == (1, 1)
    assert wide["warnings"] == [] and wide["faults"] == []

    near = hints(0.1)  # 6 minutes: only the 08:50 reading is close to the 08:45 event
    assert [
        (w["code"], w["on_with"], w["off_with"], w["share_on"], w["share_off"])
        for w in near["warnings"]
    ] == [
        ("$182", 1, 0, 1.0, 0.0),
        ("$210", 1, 0, 1.0, 0.0),
        ("$21D", 1, 0, 1.0, 0.0),
    ]
    assert (
        near["warnings"][0]["title"] == "Unknown warning $182"
        and near["warnings"][0]["known"] is False
    )
    assert [(f["ecu"], f["dtc_code"], f["share_on"]) for f in near["faults"]] == [
        ("ADU", "C1681", 1.0)
    ]

    # a third reading, far from everything and off: now the codes are near the flag half as often when it is off
    con = duckdb.connect(str(db))
    con.execute(
        "INSERT INTO signal_readings VALUES ('rts', 'V', 'x', ?, NULL, ?, '0', 0, NULL)",
        [T0 + timedelta(hours=12), BODY],
    )
    con.close()
    later = hints(2)
    assert [(w["code"], w["share_on"], w["share_off"]) for w in later["warnings"]] == [
        ("$182", 1.0, 0.5),
        ("$210", 1.0, 0.5),
        ("$21D", 1.0, 0.5),
    ]


def test_hints_for_a_flag_that_never_changes_or_does_not_exist_are_a_404(
    data_dir, tmp_path
):
    db = make_db(data_dir, tmp_path)
    con = duckdb.connect(str(db))
    add_flag(con, CONSTANT, [0, 0, 0])
    con.close()
    os.environ["MAZDA_DB"] = str(db)
    client = TestClient(app)
    for flag in (CONSTANT, "nope"):
        r = client.get("/api/status/warning-flags/hints", params={"flag": flag})
        assert r.status_code == 404 and r.json() == {
            "detail": f"No warning flag {flag} that changes"
        }
    assert (
        client.get(
            "/api/status/warning-flags/hints", params={"flag": BODY, "window_hours": 0}
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/status/warning-flags/hints", params={"flag": BODY, "window_hours": 49}
        ).status_code
        == 422
    )
    assert client.get("/api/status/warning-flags/hints").status_code == 422
    assert client.get("/api/status/warning-flags").json() == {
        "has_data": False,
        "first_read_at": None,
        "last_read_at": None,
        "flags": [],
        "episodes": [],
    }


# ------------------------------------------------------ alert rule


def cfg(**rule):
    return AlertsConfig.model_validate(
        {"lookback_days": 400, "rules": {"new_warning_flag": rule} if rule else {}}
    )


def flag_alerts(created):
    return [c for c in created if c.rule == "new_warning_flag"]


def test_a_flag_set_for_the_first_time_is_one_alert(con):
    add_flag(con, BODY, [0, 0, 1, 1, 0, 1])
    (alert,) = flag_alerts(run_alerts(con, cfg()))
    assert alert.dedup_key == f"new_warning_flag:{BODY}"
    assert (
        alert.title == "New warning-lamp flag set: body bit 30"
        and alert.severity == "info"
    )
    assert (
        "3 of 6 readings" in alert.detail and "Mazda does not publish" in alert.detail
    )
    assert alert.occurred_at == datetime(2026, 6, 15, 8, 0) and alert.link == "/status"
    add_flag(
        con, BODY, [1, 1], start=T0 + timedelta(days=30)
    )  # still on later: not new again
    assert flag_alerts(run_alerts(con, cfg())) == []


def test_only_flags_first_set_inside_the_lookback_alert(con):
    add_flag(
        con, BODY, [0, 1], start=datetime(2026, 1, 1)
    )  # first set long before the newest data
    add_flag(
        con, PT, [0, 1], start=datetime(2026, 10, 14, 9, 0)
    )  # first set the day before it
    narrow = AlertsConfig.model_validate({"lookback_days": 10})
    got = flag_alerts(run_alerts(con, narrow))
    assert [a.dedup_key for a in got] == [f"new_warning_flag:{PT}"]
    assert (
        "diagnostic report was taken" in got[0].detail
    )  # 2026-10-15 is the fixture's report day


def test_the_meaning_you_gave_a_flag_is_used(data_dir, tmp_path):
    con = duckdb.connect(str(make_db(data_dir, tmp_path, LABELS)))
    add_flag(con, BODY, [0, 1])
    (alert,) = flag_alerts(run_alerts(con, cfg()))
    assert (
        alert.title == "New warning-lamp flag set: Example lamp"
        and alert.severity == "warning"
    )
    assert "Mazda does not publish" not in alert.detail


def test_flags_can_be_ignored_and_the_rule_switched_off(con):
    add_flag(con, BODY, [0, 1])
    add_flag(con, PT, [0, 1])
    assert [
        a.dedup_key for a in flag_alerts(run_alerts(con, cfg(ignore_flags=[BODY])))
    ] == [f"new_warning_flag:{PT}"]
    assert flag_alerts(run_alerts(con, cfg(enabled=False))) == []


def test_a_misspelt_flag_name_is_an_error():
    with pytest.raises(ValidationError, match="not a warning-lamp flag name"):
        cfg(ignore_flags=["vdt_7_warningbod_1_30"])


# ------------------------------------------------------ API and sample data


@pytest.fixture(scope="module")
def demo_db(tmp_path_factory):
    root = tmp_path_factory.mktemp("flags-sample")
    generate(root / "data")
    db = root / "demo.duckdb"
    ingest(root / "data", db, CONFIG / "codes")
    evaluate(db, CONFIG / "alerts.yaml")
    return db


def test_the_sample_shows_the_changing_flags_and_hides_the_constant_ones(demo_db):
    os.environ["MAZDA_DB"] = str(demo_db)
    body = TestClient(app).get("/api/status/warning-flags").json()
    assert body["has_data"] is True and body["first_read_at"].endswith("Z")
    flags = {f["flag"]: f for f in body["flags"]}
    assert set(flags) == {
        BODY,
        PT,
        "vdt_2_warningpt_2_46",
        "vdt_7_warningbody_2_44",
    }  # not ..._1_0 / ..._1_1
    assert [f["area"] for f in body["flags"]] == [
        "powertrain",
        "powertrain",
        "body",
        "body",
    ]  # power train first
    assert flags[BODY]["pct_on"] > 40 and flags[BODY]["first_on_report_day"] is False
    assert (
        flags[PT]["first_on_report_day"] is True
        and flags["vdt_2_warningpt_2_46"]["first_on_report_day"] is True
    )
    assert flags["vdt_7_warningbody_2_44"]["on_now"] is True
    assert {e["flag"] for e in body["episodes"]} == set(flags)


def test_the_sample_raises_the_new_flag_alert_once_and_lists_unmapped_flags(demo_db):
    con = duckdb.connect(str(demo_db), read_only=True)
    alerts = con.execute(
        "SELECT title, severity FROM alerts WHERE rule = 'new_warning_flag'"
    ).fetchall()
    unmapped = con.execute(
        "SELECT count(*) FROM v_unmapped_codes WHERE kind = 'warning flag'"
    ).fetchone()
    con.close()
    assert alerts == [
        ("New warning-lamp flag set: body bit 44", "info")
    ]  # the others were first set long ago
    assert unmapped == (4,)


def test_the_sample_hints_return_shares_between_0_and_1_ranked_by_contrast(demo_db):
    os.environ["MAZDA_DB"] = str(demo_db)
    client = TestClient(app)
    for flag in (BODY, PT, "vdt_7_warningbody_2_44"):
        h = client.get("/api/status/warning-flags/hints", params={"flag": flag}).json()
        assert (
            h["on_readings"] > 0 and h["off_readings"] > 0 and len(h["warnings"]) <= 8
        )
        contrast = [(w["share_on"] or 0) - (w["share_off"] or 0) for w in h["warnings"]]
        assert contrast == sorted(contrast, reverse=True) and all(
            c > 0 for c in contrast
        )
        assert all(
            0 <= (w["share_on"] or 0) <= 1 and 0 <= (w["share_off"] or 0) <= 1
            for w in h["warnings"] + h["faults"]
        )
