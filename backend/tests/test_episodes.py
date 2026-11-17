"""GET /api/warnings/episodes: warnings grouped into episodes and recurring patterns (PLAN.md M63)."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.ingest.schema import init_schema
from mazda_dash.model import build_model
from mazda_dash.model.settings import load_settings
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]
CODES = REPO / "config" / "models" / "cx5" / "codes"
T0 = datetime(2026, 6, 1, 8, 0)


def make_db(tmp_path: Path, moments, faults=(), settings="car_timezone: UTC\n") -> Path:
    """``moments``: (time, [codes]) each one warning event; ``faults``: (time, ecu, code) each one read-out."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    db = tmp_path / "t.duckdb"
    (tmp_path / "settings.yaml").write_text(settings)
    con = duckdb.connect(str(db))
    init_schema(con)
    for i, (at, codes) in enumerate(moments):
        con.execute(
            "INSERT INTO warning_events (transaction_id, vin, triggered_at, warning_list) VALUES (?, 'V', ?, ?)",
            [f"w{i}", at, ",".join(codes)],
        )
        con.executemany(
            "INSERT INTO warning_codes VALUES (?, ?)", [[f"w{i}", c] for c in codes]
        )
    for i, (at, ecu, code) in enumerate(faults):
        con.execute(
            "INSERT INTO dtc_headers (transaction_id, vin, triggered_at) VALUES (?, 'V', ?)",
            [f"d{i}", at],
        )
        con.execute(
            "INSERT INTO dtc_readings (transaction_id, ecu, kind, dtc_code) VALUES (?, ?, 'fault', ?)",
            [f"d{i}", ecu, code],
        )
    build_model(con, CODES, tmp_path / "settings.yaml")
    con.close()
    return db


def episodes_of(sets, start=T0, every=timedelta(days=1)):
    """One episode per set of codes, a day apart, each code a moment one minute after the other."""
    out = []
    for n, codes in enumerate(sets):
        for k, code in enumerate(codes):
            out.append((start + n * every + timedelta(minutes=k), [code]))
    return out


def get(db: Path, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get("/api/warnings/episodes", params=params)
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def view(db: Path, sql: str):
    con = duckdb.connect(str(db), read_only=True)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_a_silence_longer_than_the_gap_starts_an_episode(tmp_path):
    m = [
        (T0, ["$A"]),
        (T0 + timedelta(minutes=10), ["$B"]),  # exactly the gap: same episode
        (T0 + timedelta(minutes=21), ["$A"]),  # 11 minutes: a new one
        (datetime(2026, 6, 1, 23, 58), ["$A"]),
        (datetime(2026, 6, 2, 0, 3), ["$C"]),  # across midnight: same episode
    ]
    db = make_db(tmp_path, m)
    got = view(
        db, "SELECT episode, moments, codes FROM v_warning_episodes ORDER BY episode"
    )
    assert got == [(1, 2, ["$A", "$B"]), (2, 1, ["$A"]), (3, 2, ["$A", "$C"])]
    assert get(db)["gap_minutes"] == 10


def test_the_gap_is_a_setting(tmp_path):
    m = [(T0, ["$A"]), (T0 + timedelta(minutes=5), ["$B"])]
    assert get(make_db(tmp_path / "a", m))["episodes"] == 1
    short = make_db(
        tmp_path / "b", m, settings="car_timezone: UTC\nwarning_episode_minutes: 3\n"
    )
    got = get(short)
    assert got["episodes"] == 2 and got["gap_minutes"] == 3


@pytest.mark.parametrize(
    ("line", "error"),
    [
        (
            "warning_episode_minutes: 0\n",
            "warning_episode_minutes must be a number from 1 to 240",
        ),
        (
            "warning_episode_minutes: 2.5\n",
            "warning_episode_minutes must be a whole number",
        ),
        ("warning_episode_minutes: soon\n", "warning_episode_minutes must be a number"),
    ],
)
def test_the_setting_is_checked(tmp_path, line, error):
    path = tmp_path / "settings.yaml"
    path.write_text(line)
    with pytest.raises(ValueError, match=error):
        load_settings(duckdb.connect(), path)


def test_a_code_in_nearly_every_episode_is_common_and_left_out(tmp_path):
    sets = [["$210", "$A", "$B"]] * 6 + [["$210", "$C", "$D"]] * 5
    got = get(make_db(tmp_path, episodes_of(sets)))
    assert got["common"] == [{"code": "$210", "title": None, "pct": 100.0}]
    assert got["recurring_patterns"] == 2
    first, second = got["patterns"]
    assert (first["pattern"], first["episodes"]) == (1, 6)
    assert [c["code"] for c in first["codes"]] == ["$A", "$B"]
    assert [c["code"] for c in second["codes"]] == ["$C", "$D"]


def test_no_code_is_common_under_ten_episodes(tmp_path):
    sets = [["$210", "$A"]] * 5 + [["$210", "$C"]] * 4
    got = get(make_db(tmp_path, episodes_of(sets)))
    assert got["common"] == []
    # with $210 kept the two sets are 1/3 alike: still two patterns
    assert [p["episodes"] for p in got["patterns"]] == [5, 4]


def test_near_copies_are_one_pattern_with_core_and_sometimes_codes(tmp_path):
    sets = [["$A", "$B", "$C"]] * 5 + [["$A", "$B"]] * 3
    got = get(make_db(tmp_path, episodes_of(sets)))
    (p,) = got["patterns"]
    assert p["episodes"] == 8 and p["recurring"] is True
    assert [(c["code"], c["role"], c["pct"]) for c in p["codes"]] == [
        ("$A", "core", 100.0),
        ("$B", "core", 100.0),
        ("$C", "sometimes", 62.5),
    ]


def test_a_set_alike_to_two_others_does_not_chain_them(tmp_path):
    # Y is alike to X (3/5) and to Z (3/5), X and Z are not (1/5): linking every alike pair would make one
    # group; Y joins the more frequent X and Z keeps its own pattern. Two $G episodes keep $C (in X, Y and Z)
    # under 90% of the episodes, so it is not common.
    x, y, z = ["$A", "$B", "$C"], ["$A", "$B", "$C", "$D", "$E"], ["$C", "$D", "$E"]
    db = make_db(tmp_path, episodes_of([x] * 5 + [y] + [z] * 4 + [["$G"]] * 2))
    got = get(db)
    assert got["common"] == []
    assert [(p["episodes"], p["episodes_total"]) for p in got["patterns"]] == [
        (6, 6),
        (4, 4),
        (2, 2),
    ]
    modes = dict(view(db, "SELECT set_key, mode_key FROM v_warning_set_modes"))
    assert modes["$A,$B,$C,$D,$E"] == "$A,$B,$C" and modes["$C,$D,$E"] == "$C,$D,$E"


def test_the_result_does_not_depend_on_the_order_rows_were_loaded(tmp_path):
    sets = [["$A", "$B", "$C"]] * 4 + [["$A", "$B"]] * 3 + [["$D"]] * 3 + [["$E", "$F"]]
    m = episodes_of(sets)
    forward = get(make_db(tmp_path / "a", m))
    backward = get(make_db(tmp_path / "b", list(reversed(m))))
    assert forward == backward
    assert forward["recurring_patterns"] == 2 and forward["one_off_episodes"] == 1


def test_an_episode_of_only_common_codes_is_a_pattern_of_its_own(tmp_path):
    sets = [["$210", "$A"]] * 8 + [["$210", "$B"]] * 3 + [["$210"]]
    got = get(make_db(tmp_path, episodes_of(sets)))
    assert [c["code"] for c in got["common"]] == ["$210"]
    assert [
        (p["episodes"], [c["code"] for c in p["codes"]]) for p in got["patterns"]
    ] == [
        (8, ["$A"]),
        (3, ["$B"]),
        (1, []),
    ]


def test_a_fault_is_listed_only_when_it_stands_out_against_all_episodes(tmp_path):
    # three $A $B episodes (days 0-2), then six $C episodes (days 3-8)
    sets = [["$A", "$B"]] * 3 + [["$C"]] * 6
    day = timedelta(days=1)
    faults = [
        (T0 + timedelta(hours=2), "BCM", "U9991"),  # near the 1st and 2nd episodes
        (T0 + day + timedelta(hours=4), "BCM", "U9991"),  # near the 2nd and 3rd
        (
            T0 + 8 * day + timedelta(hours=30),
            "DCM",
            "U9992",
        ),  # 30 h after the last: too far
        # read out every day: near every episode, so near no pattern more than any other
        *[(T0 + n * day + timedelta(hours=1), "BCM", "U9993") for n in range(9)],
    ]
    got = get(make_db(tmp_path, episodes_of(sets), faults))
    ab, c = sorted(got["patterns"], key=lambda p: p["codes"][0]["code"])
    # code descriptions are the owner's: an undescribed fault has no title
    assert ab["faults"] == [
        {
            "ecu": "BCM",
            "dtc_code": "U9991",
            "title": None,
            "episodes": 3,
            "pct": 100.0,
            "pct_all": 33.3,
        }
    ]
    assert c["faults"] == []
    assert got["fault_hours"] == 24


def test_a_fault_near_only_two_episodes_is_not_listed(tmp_path):
    sets = [["$A", "$B"]] * 3 + [["$C"]] * 6
    faults = [
        (T0 + timedelta(hours=2), "BCM", "U9991")
    ]  # near the 1st and 2nd episodes only
    got = get(make_db(tmp_path, episodes_of(sets), faults))
    assert all(p["faults"] == [] for p in got["patterns"])


def test_a_codes_companions_are_the_codes_in_most_of_its_episodes(tmp_path):
    sets = (
        [["$A", "$B", "$C"]] * 5
        + [["$A", "$B"]] * 3
        + [["$D", "$E"]] * 3
        + [["$F", "$A"]] * 2
    )
    got = get(make_db(tmp_path, episodes_of(sets)))
    assert got["companions"] == [
        {"code": "$A", "episodes": 10, "codes": ["$B"]},  # $B in 8 of 10 = 80%
        {"code": "$B", "episodes": 8, "codes": ["$A"]},
        {"code": "$C", "episodes": 5, "codes": ["$A", "$B"]},
        {"code": "$D", "episodes": 3, "codes": ["$E"]},
        {"code": "$E", "episodes": 3, "codes": ["$D"]},
    ]  # $F: in 2 episodes only


def test_the_period_counts_episodes_but_keeps_the_patterns(tmp_path):
    sets = [["$A", "$B"]] * 6 + [["$C"]] * 3
    db = make_db(tmp_path, episodes_of(sets))
    every = get(db)
    late = get(db, **{"from": "2026-06-06"})  # the 6th $A $B episode and the three $C
    assert [
        (p["pattern"], p["episodes"], p["episodes_total"]) for p in every["patterns"]
    ] == [(1, 6, 6), (2, 3, 3)]
    assert [
        (p["pattern"], p["episodes"], p["episodes_total"]) for p in late["patterns"]
    ] == [(2, 3, 3), (1, 1, 6)]
    assert late["episodes"] == 4


def test_no_warnings_at_all(tmp_path):
    got = get(make_db(tmp_path, []))
    assert got["episodes"] == 0 and got["patterns"] == [] and got["common"] == []


@pytest.fixture(scope="module")
def samples(tmp_path_factory):
    root = tmp_path_factory.mktemp("episodes")
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
def test_both_sample_cars_have_recurring_patterns(samples, pid):
    got = get(samples[pid])
    assert got["recurring_patterns"] >= 2 and len(got["common"]) == 1
    assert got["episodes"] == sum(p["episodes"] for p in got["patterns"])
    assert (
        got["episodes"]
        == view(samples[pid], "SELECT count(*) FROM v_warning_episodes")[0][0]
    )
    # every warning moment is in exactly one episode
    moments = view(
        samples[pid],
        "SELECT count(DISTINCT triggered_at) FROM v_warnings WHERE triggered_at IS NOT NULL",
    )
    assert view(samples[pid], "SELECT sum(moments) FROM v_warning_episodes") == moments
