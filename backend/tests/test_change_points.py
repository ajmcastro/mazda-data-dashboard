"""Consumption change points (PLAN.md M65): the segmentation itself and GET /api/trends/change-points."""

import random
from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.api.changes import change_points
from mazda_dash.changepoints import noise, segment
from mazda_dash.ingest import ingest
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]


def series(n=160, step=0.0, at=80, seed=1, sd=0.5):
    """Stretches like the sample's: 10-24 km mostly, sometimes longer, 7.9 l/100 km, `step` more from `at` on."""
    r = random.Random(seed)
    xs, ws = [], []
    for i in range(n):
        km = r.uniform(10, 24) if r.random() < 0.8 else r.uniform(25, 150)
        xs.append(r.gauss(7.9, sd) + (step if i >= at else 0))
        ws.append(km)
    return xs, ws


def cuts(xs, ws, **kw):
    args = {"min_weight": 150, "min_count": 10, "min_step": 0.3} | kw
    return [s.start for s in segment(xs, ws, **args)][1:]


def test_a_flat_series_has_no_change():
    assert cuts(*series()) == []


def test_a_step_is_found_near_where_it_is():
    (k,) = cuts(*series(step=0.9))
    assert 75 <= k <= 85
    segs = segment(*series(step=0.9), 150, 10, 0.3)
    assert segs[1].mean - segs[0].mean == pytest.approx(0.9, abs=0.3)
    assert (
        sum(s.count for s in segs) == 160 and segs[0].start == 0 and segs[-1].end == 160
    )


def test_two_steps_are_both_found():
    xs, ws = series(n=240, step=1.0, at=80)
    xs = [x - (1.2 if i >= 160 else 0) for i, x in enumerate(xs)]
    assert len(cuts(xs, ws)) == 2


def test_a_change_needs_enough_on_each_side_and_a_large_enough_step():
    xs, ws = series(step=1.5, at=150)  # only 10 stretches after
    assert cuts(xs, ws) == [150]
    assert 150 not in cuts(
        xs, ws, min_count=11
    )  # a side needs 11: the split can only move, never sit at 150
    assert cuts(xs, ws, min_weight=10_000) == []
    assert cuts(*series(step=1.5), min_step=2.0) == []


def test_the_noise_is_not_inflated_by_the_step():
    flat, w = series()
    stepped, _ = series(step=3.0)
    assert noise(stepped, w) == pytest.approx(noise(flat, w), rel=0.1)


def test_empty_and_tiny_series():
    assert segment([], [], 150, 10, 0.3) == []
    (s,) = segment([7.0], [20.0], 150, 10, 0.3)
    assert (s.count, s.mean) == (1, 7.0)


def test_the_same_input_gives_the_same_answer():
    xs, ws = series(step=0.9)
    assert segment(xs, ws, 150, 10, 0.3) == segment(list(xs), list(ws), 150, 10, 0.3)


# ------------------------------------------------------------ the route


def fake_db(stretches):
    """An in-memory database whose v_trip_segments is a plain table: (end_at, km, l/100 km, gap_hours)."""
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE v_trip_segments (start_at TIMESTAMP, end_at TIMESTAMP, km DOUBLE, fuel_l DOUBLE, gap_hours DOUBLE)"
    )
    if stretches:
        con.executemany(
            "INSERT INTO v_trip_segments VALUES (?, ?, ?, ?, ?)",
            [
                [at - timedelta(minutes=30), at, km, km * l / 100, gap]
                for at, km, l, gap in stretches
            ],
        )
    return con


def test_segments_carry_their_share_of_short_stretches():
    t0 = datetime(2026, 6, 1, 8)
    xs, ws = series(step=1.2)
    rows = [
        (t0 + timedelta(hours=6 * i), w, x, 3.0)
        for i, (x, w) in enumerate(zip(xs, ws, strict=True))
    ]
    # short stretches (under 5 km): not in the series, but counted in the mix of the segment they fall in
    rows += [
        (t0 + timedelta(hours=6 * i + 1), 2.0, 12.0, 3.0) for i in range(0, 80, 4)
    ]  # 20 before the step
    rows += [
        (t0 + timedelta(hours=6 * 200), 30.0, 7.0, 60.0)
    ]  # reports 60 h apart: left out entirely
    got = change_points(fake_db(rows))
    assert got.stretches == 160 and got.enough
    first, second = got.segments
    assert first.stretches + second.stretches == 160
    assert first.short_pct == pytest.approx(100 * 20 / (first.stretches + 20), abs=0.1)
    assert second.short_pct == 0.0
    assert second.l_per_100km - first.l_per_100km == pytest.approx(1.2, abs=0.3)
    assert first.to_at < second.from_at


def test_too_little_driving_is_one_segment_and_not_enough():
    t0 = datetime(2026, 6, 1, 8)
    got = change_points(
        fake_db([(t0 + timedelta(hours=i), 10.0, 7.0, 1.0) for i in range(12)])
    )
    assert not got.enough and len(got.segments) == 1


def test_no_driving_at_all():
    got = change_points(fake_db([]))
    assert got.segments == [] and got.stretches == 0 and not got.enough


@pytest.fixture(scope="module")
def samples(tmp_path_factory):
    root = tmp_path_factory.mktemp("changes")
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


def get(db: Path):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get("/api/trends/change-points")
        assert r.status_code == 200, r.text
        return r.json()
    finally:
        mp.undo()


def test_the_cx5_sample_has_no_change_and_the_cx60_its_planted_step(samples):
    assert len(get(samples["cx5"])["segments"]) == 1
    before, after = get(samples["cx60"])["segments"]
    step_day = PROFILES["cx60"].l100_step[0]
    # the first stretch after the step starts at the report before it, which can be the evening before
    assert before["to_at"][:10] <= step_day.isoformat() < after["to_at"][:10]
    assert abs(
        datetime.fromisoformat(after["from_at"][:10]).date() - step_day
    ) <= timedelta(days=1)
    assert after["l_per_100km"] > before["l_per_100km"] + 0.5
