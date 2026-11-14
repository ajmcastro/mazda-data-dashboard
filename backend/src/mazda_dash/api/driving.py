"""How the car is driven (PLAN.md M48): the stretches of driving of ``v_trip_segments`` by length.

A *stretch* is the driving between two consecutive status reports (the data has no trips as such). A stretch
whose two reports are ``GAP_HOURS`` or more apart is not put in a band: it is probably several drives, so its
length says nothing; it is counted apart as ``unclassified``. The month totals count every stretch, so their
consumption equals the Trends page's. A consumption is given only from ``MIN_KM`` on (the car rounds the average
it reports, so a few kilometres give a meaningless figure).

The same SQL runs in the phone app (``mobile/src/engine/driving.ts``): keep the two identical."""

import duckdb

from . import models as m
from .dates import DateRange
from .db import one, rows

GAP_HOURS = 48
MIN_KM = 20
# (name, from km, up to km): a stretch of exactly 5 km is in the second band
BANDS: list[tuple[str, float, float | None]] = [
    ("under_5", 0, 5),
    ("5_to_20", 5, 20),
    ("20_to_100", 20, 100),
    ("over_100", 100, None),
]

BAND_SQL = (
    "CASE WHEN km < 5 THEN 'under_5' WHEN km < 20 THEN '5_to_20' WHEN km < 100 THEN '20_to_100' "
    "ELSE 'over_100' END"
)
MONTH_SQL = "strftime(date_trunc('month', end_at), '%Y-%m')"
FIGURES = (
    "count(*) AS stretches, round(coalesce(sum(km), 0), 1) AS km, round(coalesce(sum(fuel_l), 0), 2) AS fuel_l, "
    f"CASE WHEN sum(km) >= {MIN_KM} THEN round(100 * sum(fuel_l) / sum(km), 2) END AS l_per_100km"
)
SPEED = (
    "round(coalesce(sum(driving_seconds), 0) / 3600.0, 1) AS driving_hours, "
    f"CASE WHEN sum(km) >= {MIN_KM} THEN round(sum(km) / nullif(sum(driving_seconds) / 3600.0, 0), 1) END "
    "AS avg_speed_kmh"
)


def _and(where: str, cond: str) -> str:
    return f"{where} AND {cond}" if where else f"WHERE {cond}"


def _bands(found: dict[str, dict]) -> list[dict]:
    """Always the four bands, in order; one nobody drove has zeros."""
    empty = {"stretches": 0, "km": 0.0, "fuel_l": 0.0, "l_per_100km": None}
    return [
        {"band": name, "min_km": lo, "max_km": hi, **empty, **found.get(name, {})}
        for name, lo, hi in BANDS
    ]


def driving_pattern(con: duckdb.DuckDBPyConnection, rng: DateRange) -> m.DrivingPattern:
    where, params = rng.clause("end_at")
    close = _and(where, f"gap_hours < {GAP_HOURS}")
    total = one(con, f"SELECT {FIGURES}, {SPEED} FROM v_trip_segments {close}", params)
    apart = one(
        con,
        "SELECT count(*) AS stretches, round(coalesce(sum(km), 0), 1) AS km FROM v_trip_segments "
        + _and(where, f"gap_hours >= {GAP_HOURS}"),
        params,
    )
    by_band = rows(
        con,
        f"SELECT {BAND_SQL} AS band, {FIGURES}, {SPEED} FROM v_trip_segments {close} GROUP BY 1 ORDER BY 1",
        params,
    )
    months = rows(
        con,
        f"SELECT {MONTH_SQL} AS month, {FIGURES} FROM v_trip_segments {where} GROUP BY 1 ORDER BY 1",
        params,
    )
    month_bands = rows(
        con,
        f"SELECT {MONTH_SQL} AS month, {BAND_SQL} AS band, {FIGURES} FROM v_trip_segments {close} "
        "GROUP BY 1, 2 ORDER BY 1, 2",
        params,
    )
    per_month: dict[str, dict[str, dict]] = {}
    for r in month_bands:
        per_month.setdefault(r.pop("month"), {})[r.pop("band")] = r
    speed = {"driving_hours": 0.0, "avg_speed_kmh": None}
    return m.DrivingPattern(
        gap_hours=GAP_HOURS,
        min_km=MIN_KM,
        **total,
        unclassified=apart,
        bands=[
            {**speed, **b}
            for b in _bands(
                {
                    r["band"]: {k: v for k, v in r.items() if k != "band"}
                    for r in by_band
                }
            )
        ],
        months=[
            {**mo, "bands": _bands(per_month.get(mo["month"], {}))} for mo in months
        ],
    )
