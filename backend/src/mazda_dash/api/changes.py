"""Consumption change points (PLAN.md M65): where the car's consumption stepped up or down, from all its data.

The series is every stretch of ``v_trip_segments`` of ``MIN_STRETCH_KM`` or more whose reports are less than
``GAP_HOURS`` apart (the stretches M48 puts in a band), each one's l/100 km weighted by its km, in time order. The
segmentation is ``changepoints.segment``. Each segment also gets the share of ALL its classified stretches that
are under 5 km (M48's short band), so the page can show the mix next to the change: context, never a cause.

The same in the phone app (``mobile/src/engine/changes.ts``): keep the two identical."""

import duckdb

from .. import changepoints
from . import models as m
from .db import rows

GAP_HOURS = 48
MIN_STRETCH_KM = 5
MIN_KM = 150
MIN_STRETCHES = 10
MIN_STEP = 0.3  # l/100 km

SERIES_SQL = (
    "SELECT start_at, end_at, km, fuel_l FROM v_trip_segments "
    f"WHERE km >= {MIN_STRETCH_KM} AND gap_hours < {GAP_HOURS} AND fuel_l IS NOT NULL "
    "ORDER BY end_at, start_at"
)
ALL_SQL = f"SELECT end_at, km FROM v_trip_segments WHERE gap_hours < {GAP_HOURS} ORDER BY end_at, start_at"


def change_points(con: duckdb.DuckDBPyConnection) -> m.ChangePoints:
    series = rows(con, SERIES_SQL)
    values = [100 * r["fuel_l"] / r["km"] for r in series]
    weights = [r["km"] for r in series]
    segments = changepoints.segment(values, weights, MIN_KM, MIN_STRETCHES, MIN_STEP)
    every = rows(con, ALL_SQL)
    out = []
    for i, s in enumerate(segments):
        first, last = series[s.start], series[s.end - 1]
        # the stretches of this segment's time: after the previous segment's last stretch, up to its own last
        after = series[segments[i - 1].end - 1]["end_at"] if i > 0 else None
        until = last["end_at"] if i < len(segments) - 1 else None
        mine = [
            r
            for r in every
            if (after is None or r["end_at"] > after)
            and (until is None or r["end_at"] <= until)
        ]
        short = sum(1 for r in mine if r["km"] < MIN_STRETCH_KM)
        out.append(
            {
                "from_at": first["start_at"],
                "to_at": last["end_at"],
                "stretches": s.count,
                "km": round(s.weight, 1),
                "l_per_100km": round(s.mean, 2),
                "short_pct": round(100 * short / len(mine), 1) if mine else None,
            }
        )
    return m.ChangePoints(
        min_km=MIN_KM,
        min_stretches=MIN_STRETCHES,
        min_step=MIN_STEP,
        stretch_km=MIN_STRETCH_KM,
        stretches=len(series),
        km=round(sum(weights), 1),
        enough=len(series) >= 2 * MIN_STRETCHES and sum(weights) >= 2 * MIN_KM,
        segments=out,
    )
