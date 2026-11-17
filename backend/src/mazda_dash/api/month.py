"""Next month at this pace (PLAN.md M71): the distance, fuel and estimated cost of the next 30 days as a range.

Counted from the newest day with data, never from today. The car's own days of the last ``WINDOW_DAYS`` are the
material: each calendar day carries the distance since the report before (``v_odometer_daily``); a day without
a report carries nothing, so a car with long silences gets a wide range, as it should. A *block bootstrap*
imagines ``REPLICATES`` months of ``MONTH_DAYS`` days, each made of whole weeks of consecutive real days
(``BLOCK_DAYS``, so weekly habits stay together), picked by a fixed Park-Miller generator (integers only, the same
sequence in Python and the browser); the range is the 10th to 90th percentile of their distances, the middle the
50th. Fuel = distance x the consumption of the window's stretches (or of the stretches since the last change point
of M65 when it is inside the window); cost = litres x the price in force on the newest day (none without a price).
Nothing is given with fewer than ``MIN_DAYS`` days with a report in the window. Seasons are not known: with less
than a year of data the same month a year before cannot be looked at, and the answer says so.

The same in the phone app (``mobile/src/engine/month.ts``): keep the two identical."""

from datetime import date, timedelta

import duckdb

from . import models as m
from .changes import change_points
from .db import one, rows

WINDOW_DAYS = 90
MONTH_DAYS = 30
BLOCK_DAYS = 7
REPLICATES = 1000
MIN_DAYS = 30
SEED = 1
MODULUS = 2147483647  # 2^31 - 1: Park-Miller "minimal standard"; products stay exact in a double
MULTIPLIER = 16807

DAILY_SQL = (
    "SELECT day, km_since_previous AS km FROM v_odometer_daily "
    "WHERE day > CAST(? AS DATE) - INTERVAL {window} DAY AND day <= CAST(? AS DATE) AND km_since_previous IS NOT NULL "
    "ORDER BY day"
)
FUEL_SQL = (
    "SELECT sum(fuel_l) AS fuel_l, sum(km) AS km FROM v_trip_segments "
    "WHERE fuel_l IS NOT NULL AND km > 0 AND end_at >= CAST(? AS TIMESTAMP) AND CAST(end_at AS DATE) <= CAST(? AS DATE)"
)
PRICE_SQL = (
    "SELECT per_l FROM v_fuel_prices WHERE valid_from <= CAST(? AS DATE) "
    "ORDER BY valid_from DESC LIMIT 1"
)


def percentile(sorted_values: list[float], q: float) -> float:
    """The value at index floor(q x (n - 1)) of an ascending list (no interpolation: the same in both apps)."""
    return sorted_values[int(q * (len(sorted_values) - 1))]


def bootstrap(daily_km: list[float]) -> list[float]:
    """REPLICATES 30-day distances made of BLOCK_DAYS-day blocks of consecutive days, ascending."""
    starts = len(daily_km) - BLOCK_DAYS + 1
    x = SEED
    out = []
    for _ in range(REPLICATES):
        month: list[float] = []
        while len(month) < MONTH_DAYS:
            x = x * MULTIPLIER % MODULUS
            s = x % starts
            month.extend(daily_km[s : s + BLOCK_DAYS])
        total = 0.0
        for v in month[:MONTH_DAYS]:
            total += v
        out.append(total)
    out.sort()
    return out


def _r(v: float | None, digits: int) -> float | None:
    return round(v, digits) if v is not None else None


def month_forecast(
    con: duckdb.DuckDBPyConnection, as_of: date | None = None
) -> m.MonthForecast:
    newest = as_of or one(con, "SELECT max(day) AS d FROM v_odometer_daily")["d"]
    empty = m.MonthForecast(
        enough=False, as_of=newest, window_days=WINDOW_DAYS, month_days=MONTH_DAYS, block_days=BLOCK_DAYS,
        replicates=REPLICATES, min_days=MIN_DAYS, days_with_data=0, months_of_data=0.0,
    )  # fmt: skip
    if newest is None:
        return empty
    first = one(con, "SELECT min(day) AS d FROM v_odometer_daily")["d"]
    found = {
        r["day"]: r["km"]
        for r in rows(con, DAILY_SQL.format(window=WINDOW_DAYS), [newest, newest])
    }
    days = [newest - timedelta(days=WINDOW_DAYS - 1 - i) for i in range(WINDOW_DAYS)]
    daily = [float(found.get(d) or 0.0) for d in days]
    months = round((newest - first).days / 30.4, 1)
    base = empty.model_copy(
        update={"days_with_data": len(found), "months_of_data": months}
    )
    if len(found) < MIN_DAYS:
        return base
    sums = bootstrap(daily)
    km = [percentile(sums, q) for q in (0.1, 0.5, 0.9)]
    # consumption: the window's stretches, or those since the last change point (M65) when it is inside the window
    since = days[0]
    if as_of is None:
        segments = change_points(con).segments
        if len(segments) > 1 and segments[-1].from_at.date() > since:
            since = segments[-1].from_at.date()
    fuel = one(con, FUEL_SQL, [since.isoformat(), newest.isoformat()])
    rate = (
        100 * fuel["fuel_l"] / fuel["km"]
        if fuel["km"] and fuel["fuel_l"] is not None
        else None
    )
    litres = [k * rate / 100 for k in km] if rate is not None else [None, None, None]
    price = one(con, PRICE_SQL, [newest.isoformat()])
    per_l = price["per_l"] if price else None
    currency = one(
        con,
        "SELECT max(value) FILTER (WHERE key = 'fuel_currency') AS c FROM ref_settings",
    )["c"]
    cost = [v * per_l if v is not None and per_l is not None else None for v in litres]
    return base.model_copy(
        update={
            "enough": True,
            "km_low": round(km[0]),
            "km_mid": round(km[1]),
            "km_high": round(km[2]),
            "l_per_100km": _r(rate, 2),
            "consumption_from": since,
            "litres_low": _r(litres[0], 0),
            "litres_mid": _r(litres[1], 0),
            "litres_high": _r(litres[2], 0),
            "price_per_l": per_l,
            "currency": currency if per_l is not None else None,
            "cost_low": _r(cost[0], 0),
            "cost_mid": _r(cost[1], 0),
            "cost_high": _r(cost[2], 0),
        }
    )
