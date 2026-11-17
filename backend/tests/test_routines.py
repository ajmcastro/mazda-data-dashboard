"""Driving routines (PLAN.md M66): the k-medoids grouping and GET /api/trips/routines."""

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.api.routines import driving_routines
from mazda_dash.ingest import ingest
from mazda_dash.routines import (
    cluster,
    distances,
    features,
    hours_around,
    kmedoids,
    median,
    silhouette,
)
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]


def week(n_weeks=6, weekday_km=17.0, weekend_km=80.0):
    """Stretches of a regular car: weekday mornings and evenings, and a long Sunday midday, in UTC."""
    out = []
    monday = datetime(2026, 6, 1)
    for w in range(n_weeks):
        for d in range(5):
            day = monday + timedelta(days=7 * w + d)
            out.append((day + timedelta(hours=8, minutes=5 * d), weekday_km + d * 0.3))
            out.append((day + timedelta(hours=18, minutes=4 * d), weekday_km - d * 0.2))
        out.append(
            (monday + timedelta(days=7 * w + 6, hours=13, minutes=w), weekend_km + w)
        )
    return out


def grouped(stretches):
    km = [k for _, k in stretches]
    hours = [t.hour + t.minute / 60 for t, _ in stretches]
    weekend = [t.isoweekday() >= 6 for t, _ in stretches]
    return cluster(features(km, hours, weekend))


def test_three_clear_kinds_of_stretch_are_found():
    k, _, groups, s = grouped(week())
    assert k == 3 and s > 0.6
    stretches = week()
    by_group = {}
    for (t, _), g in zip(stretches, groups, strict=True):
        by_group.setdefault(g, set()).add((t.isoweekday() >= 6, t.hour))
    kinds = sorted(sorted(v) for v in by_group.values())
    assert kinds == [[(False, 8)], [(False, 18)], [(True, 13)]]


def test_the_hour_is_on_a_circle():
    # 23:30 and 00:30 are an hour apart, not 23
    p = features([10, 10, 10], [23.5, 0.5, 12.0], [False] * 3)
    d = distances(p)
    assert d[0][1] < d[0][2] / 3
    hour, low, high = hours_around([23.5, 23.75, 0.25, 0.5])
    assert hour == pytest.approx(0.0, abs=0.01) or hour == pytest.approx(24.0, abs=0.01)
    assert (low, high) == (pytest.approx(23.5), pytest.approx(0.5))


def test_kmedoids_is_deterministic_and_assigns_every_point():
    p = features(
        [1, 2, 3, 50, 60, 70],
        [8, 8, 9, 13, 14, 13],
        [False, False, False, True, True, True],
    )
    d = distances(p)
    a = kmedoids(d, 2)
    assert a == kmedoids(d, 2)
    _medoids, groups = a
    assert (
        len(set(groups)) == 2
        and groups[:3] == [groups[0]] * 3
        and groups[3:] == [groups[3]] * 3
    )
    assert silhouette(d, groups, 2) > 0.5


def test_too_few_points_are_one_group():
    assert cluster([])[0] == 1
    assert cluster(features([5, 6, 7], [8, 9, 10], [False] * 3))[0] == 1


def test_median():
    assert median([]) is None and median([3, 1, 2]) == 2 and median([4, 1, 3, 2]) == 2.5


# ------------------------------------------------------------ the route


def fake_db(stretches, zone="UTC"):
    """In-memory tables standing in for v_trip_segments and ref_settings: (end_at, km, fuel_l, seconds, gap)."""
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE v_trip_segments (start_at TIMESTAMP, end_at TIMESTAMP, km DOUBLE, fuel_l DOUBLE, "
        "driving_seconds DOUBLE, gap_hours DOUBLE)"
    )
    con.execute("CREATE TABLE ref_settings (key VARCHAR, value VARCHAR)")
    con.execute("INSERT INTO ref_settings VALUES ('car_timezone', ?)", [zone])
    if stretches:
        con.executemany(
            "INSERT INTO v_trip_segments VALUES (?, ?, ?, ?, ?, ?)",
            [
                [at - timedelta(hours=1), at, km, fuel, sec, gap]
                for at, km, fuel, sec, gap in stretches
            ],
        )
    return con


def regular(**kw):
    return [(t, km, km * 0.07, km * 60, 2.0) for t, km in week(**kw)]


def test_routines_are_described_and_numbered_by_size():
    got = driving_routines(
        fake_db(regular(n_weeks=8))
    )  # 8 Sundays: a routine needs 8 stretches
    assert got.enough and got.clear and got.k == 3 and got.other_stretches == 0
    first, second, third = got.routines
    assert (first.stretches, second.stretches, third.stretches) == (40, 40, 8)
    assert sorted([first.hour, second.hour]) == [
        pytest.approx(8.2, abs=0.2),
        pytest.approx(18.1, abs=0.2),
    ]
    assert first.weekend_pct == 0.0 and third.weekend_pct == 100.0
    assert third.km_median == pytest.approx(83.5) and third.days == 8
    assert first.l_per_100km == pytest.approx(
        7.0
    ) and first.minutes_median == pytest.approx(first.km_median)
    assert sum(r.km_share_pct for r in got.routines) == pytest.approx(100, abs=0.2)
    assert [mm.routine for mm in got.members].count(3) == 8


def test_the_hours_are_the_cars_local_time():
    got = driving_routines(fake_db(regular(), zone="Europe/Lisbon"))  # summer: UTC + 1
    assert sorted(r.hour for r in got.routines[:2]) == [
        pytest.approx(9.2, abs=0.2),
        pytest.approx(19.1, abs=0.2),
    ]


def test_a_small_group_is_other_and_too_few_stretches_are_nothing():
    got = driving_routines(
        fake_db(regular(n_weeks=3))
    )  # the Sunday group: 3 stretches on 3 days
    assert [r.stretches for r in got.routines] == [15, 15]
    assert got.other_stretches == 3
    few = driving_routines(fake_db(regular()[:20]))
    assert not few.enough and few.routines == [] and few.other_stretches == 20


def test_a_negative_fuel_figure_is_left_out_of_the_consumption():
    stretches = regular()
    t, km, _, sec, gap = stretches[0]
    stretches[0] = (t, km, -5.0, sec, gap)  # a trip-computer reset between two reports
    got = driving_routines(fake_db(stretches))
    morning = next(r for r in got.routines if r.hour < 12 and r.weekend_pct == 0)
    assert morning.l_per_100km == pytest.approx(7.0)


def test_stretches_across_two_days_without_a_report_are_left_out():
    stretches = [*regular(), (datetime(2026, 7, 20, 3), 500.0, 30.0, 20000.0, 60.0)]
    assert driving_routines(fake_db(stretches)).stretches == len(regular())


def test_no_driving():
    got = driving_routines(fake_db([]))
    assert got.stretches == 0 and got.routines == [] and not got.enough


@pytest.fixture(scope="module")
def samples(tmp_path_factory):
    root = tmp_path_factory.mktemp("routines")
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
def test_both_sample_cars_have_their_three_planned_routines(samples, pid):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(samples[pid]))
    try:
        r = TestClient(app).get("/api/trips/routines")
    finally:
        mp.undo()
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["clear"] and len(got["routines"]) == 3
    weekend = [x for x in got["routines"] if x["weekend_pct"] == 100]
    assert len(weekend) == 1 and weekend[0]["km_median"] > 50
