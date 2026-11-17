"""Driving routines (PLAN.md M66): the stretches of driving grouped into the car's recurring kinds of stretch,
from all its data (``routines.py`` has the method).

A stretch is one row of ``v_trip_segments`` whose reports are under ``GAP_HOURS`` apart (as M48), with a
distance. Its time is when it ENDED, in the car's local time: a stretch starts at the report before it, which
may be hours earlier, but the report at its end comes as the car stops. A group is a *routine* when it holds
``MIN_STRETCHES`` stretches on ``MIN_DAYS`` different days and the grouping as a whole is clear (mean silhouette
``MIN_SILHOUETTE`` or more); everything else is "other". Words only: a routine is a kind of stretch, never a
place (no position is read) and never a judgement of the driver.

The same in the phone app (``mobile/src/engine/routines.ts``): keep the two identical."""

import duckdb

from .. import routines
from . import models as m
from .db import rows

GAP_HOURS = 48
MIN_STRETCHES = 8
MIN_DAYS = 4
MIN_SILHOUETTE = 0.25
MIN_KM = 20  # a consumption from this distance on, as M48
ENOUGH = 30  # stretches before any grouping is tried

STRETCHES_SQL = (
    "WITH cfg AS (SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone "
    "FROM ref_settings), s AS (SELECT t.end_at, t.km, t.fuel_l, t.driving_seconds, "
    "timezone(c.zone, make_timestamptz(epoch_us(t.end_at))) AS local_end "
    f"FROM v_trip_segments t CROSS JOIN cfg c WHERE t.gap_hours < {GAP_HOURS} AND t.km > 0) "
    "SELECT end_at, km, fuel_l, driving_seconds, hour(local_end) + minute(local_end) / 60.0 AS hour, "
    "isodow(local_end) >= 6 AS weekend, strftime(local_end, '%Y-%m-%d') AS local_day "
    "FROM s ORDER BY end_at"
)


def _describe(group: list[dict]) -> dict:
    km = sum(r["km"] for r in group)
    # a negative fuel figure comes from a trip-computer reset between two reports: left out of the consumption
    priced = [r for r in group if r["fuel_l"] is not None and r["fuel_l"] >= 0]
    fuel = [r["fuel_l"] for r in priced]
    fuel_km = sum(r["km"] for r in priced)
    minutes = [
        r["driving_seconds"] / 60
        for r in group
        if r["driving_seconds"] and r["driving_seconds"] > 0
    ]
    hour, low, high = routines.hours_around([r["hour"] for r in group])
    return {
        "stretches": len(group),
        "days": len({r["local_day"] for r in group}),
        "km": round(km, 1),
        "km_median": round(routines.median([r["km"] for r in group]), 1),
        "minutes_median": round(routines.median(minutes), 1) if minutes else None,
        "weekend_pct": round(
            100 * sum(1 for r in group if r["weekend"]) / len(group), 1
        ),
        "hour": round(hour, 1),
        "hour_low": round(low, 1),
        "hour_high": round(high, 1),
        "l_per_100km": round(100 * sum(fuel) / fuel_km, 2)
        if fuel_km >= MIN_KM
        else None,
    }


def driving_routines(con: duckdb.DuckDBPyConnection) -> m.Routines:
    found = rows(con, STRETCHES_SQL)
    n = len(found)
    k, silhouette, labels = 1, 0.0, [None] * n
    if n >= ENOUGH:
        points = routines.features(
            [r["km"] for r in found],
            [r["hour"] for r in found],
            [r["weekend"] for r in found],
        )
        k, _, groups, silhouette = routines.cluster(points)
        clear = silhouette >= MIN_SILHOUETTE
        kept = []
        for g in range(k):
            members = [i for i in range(n) if groups[i] == g]
            if (
                clear
                and len(members) >= MIN_STRETCHES
                and len({found[i]["local_day"] for i in members}) >= MIN_DAYS
            ):
                kept.append(members)
        # numbered from the routine with the most stretches (ties: the earliest first stretch)
        kept.sort(key=lambda ms: (-len(ms), ms[0]))
        for number, members in enumerate(kept, start=1):
            for i in members:
                labels[i] = number
    total_km = sum(r["km"] for r in found)
    listed = []
    for number in range(1, max([x for x in labels if x is not None], default=0) + 1):
        group = [found[i] for i in range(n) if labels[i] == number]
        d = _describe(group)
        listed.append(
            {"routine": number, **d, "km_share_pct": round(100 * d["km"] / total_km, 1)}
        )
    other = [found[i] for i in range(n) if labels[i] is None]
    return m.Routines(
        enough=n >= ENOUGH,
        stretches=n,
        km=round(total_km, 1),
        k=k,
        silhouette=round(silhouette, 3),
        clear=silhouette >= MIN_SILHOUETTE,
        min_stretches=MIN_STRETCHES,
        min_days=MIN_DAYS,
        min_silhouette=MIN_SILHOUETTE,
        routines=listed,
        other_stretches=len(other),
        other_km=round(sum(r["km"] for r in other), 1),
        members=[
            {"end_at": found[i]["end_at"], "routine": labels[i]} for i in range(n)
        ],
    )
