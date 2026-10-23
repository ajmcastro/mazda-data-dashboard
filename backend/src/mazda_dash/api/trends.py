"""Month-by-month metrics for the Trends page.

Everything is aggregated from the events inside the selected period, so a month cut by the period
only counts its days inside it (and is reported as partial). Months without any data are kept in
the series with empty metrics, so charts show a gap instead of a misleading zero."""

import calendar
from datetime import date, datetime, time, timedelta

import duckdb

from .dates import DateRange
from .db import one, rows


def _month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def _month_series(first: date, last: date) -> list[date]:
    months, d = [], date(first.year, first.month, 1)
    while d <= last:
        months.append(d)
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return months


def _by_month(con, sql: str, params: list | None = None) -> dict[str, dict]:
    return {r["month"]: r for r in rows(con, sql, params)}


def _month_sql(col: str) -> str:
    return f"strftime(date_trunc('month', {col}), '%Y-%m')"


def monthly_metrics(con: duckdb.DuckDBPyConnection, rng: DateRange) -> list[dict]:
    span = one(
        con,
        "SELECT CAST(min(read_at) AS DATE) AS a, CAST(max(read_at) AS DATE) AS b "
        "FROM v_odometer_readings",
    )
    if not span.get("a"):
        return []
    lo = max(rng.start, span["a"]) if rng.start else span["a"]
    hi = min(rng.end, span["b"]) if rng.end else span["b"]
    if lo > hi:
        return []

    def where(col: str, prefix: str = "WHERE") -> tuple[str, list]:
        return rng.clause(col, prefix)

    w, p = where("read_at")
    odo = _by_month(
        con,
        f"SELECT {_month_sql('read_at')} AS month, max(odometer_km) AS end_odo, "
        f"min(odometer_km) AS min_odo FROM v_odometer_readings {w} GROUP BY 1",
        p,
    )
    w, p = where("end_at")
    drives = _by_month(
        con,
        f"SELECT {_month_sql('end_at')} AS month, sum(km) AS km, sum(fuel_l) AS fuel_l, "
        "sum(driving_seconds) AS secs, count(*) AS drives, "
        f"count(DISTINCT CAST(end_at AS DATE)) AS days_driven FROM v_trip_segments {w} GROUP BY 1",
        p,
    )
    w, p = where("triggered_at")
    events = _by_month(
        con,
        f"SELECT {_month_sql('triggered_at')} AS month, count(*) AS n FROM warning_events {w} GROUP BY 1",
        p,
    )
    codes = _by_month(
        con,
        f"SELECT {_month_sql('triggered_at')} AS month, count(DISTINCT code) AS n "
        f"FROM v_warnings {w} GROUP BY 1",
        p,
    )
    w, p = where("event_at")
    readouts = _by_month(
        con,
        f"SELECT {_month_sql('event_at')} AS month, count(*) FILTER (WHERE faults > 0) AS n "
        f"FROM v_dtc_readout_summary {w} GROUP BY 1",
        p,
    )
    faults = _by_month(
        con,
        f"SELECT {_month_sql('event_at')} AS month, "
        "count(DISTINCT ecu || '|' || dtc_code || '|' || coalesce(failure_type, '')) AS n "
        f"FROM v_dtc_events {w} GROUP BY 1",
        p,
    )
    # "New" = first reported after the first day of diagnostic data. Whatever the car listed on that
    # first day may have been there long before the data begins, so it is not a new fault.
    new_faults = _by_month(
        con,
        f"SELECT {_month_sql('first_seen')} AS month, count(*) AS n FROM ("
        "SELECT min(event_at) AS first_seen FROM v_dtc_events GROUP BY ecu, dtc_code, failure_type "
        "HAVING CAST(min(event_at) AS DATE) > (SELECT CAST(min(coalesce(triggered_at, copied_at)) AS DATE) "
        f"FROM dtc_headers)) {rng.clause('first_seen')[0]} GROUP BY 1",
        rng.clause("first_seen")[1],
    )
    w, p = where("created_at")
    tires = _by_month(
        con,
        f"SELECT {_month_sql('created_at')} AS month, "
        "(avg(tire_fl_kpa) + avg(tire_fr_kpa) + avg(tire_rl_kpa) + avg(tire_rr_kpa)) / 4 AS avg_kpa, "
        "min(least(tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa)) AS min_kpa "
        f"FROM v_vehicle_status {w} GROUP BY 1",
        p,
    )

    out = []
    for first_of_month in _month_series(lo, hi):
        key = _month_key(first_of_month)
        days_in_month = calendar.monthrange(first_of_month.year, first_of_month.month)[
            1
        ]
        end_of_month = first_of_month + timedelta(days=days_in_month - 1)
        covered = (min(hi, end_of_month) - max(lo, first_of_month)).days + 1
        row: dict = {
            "month": key,
            "days_in_month": days_in_month,
            "days_covered": covered,
            "partial": covered < days_in_month,
        }

        o, d = odo.get(key), drives.get(key)
        if o:
            # Distance: highest odometer in the month minus the last reading before the month (or
            # before the period starts, if later); the month's own lowest reading if there is none.
            effective_start = (
                max(first_of_month, rng.start) if rng.start else first_of_month
            )
            base = one(
                con,
                "SELECT max(odometer_km) AS v FROM v_odometer_readings WHERE read_at < ?",
                [datetime.combine(effective_start, time.min)],
            )["v"]
            base = o["min_odo"] if base is None else base
            row["distance_km"] = round(o["end_odo"] - base, 1)
        if d:
            row["drives"] = d["drives"]
            row["days_driven"] = d["days_driven"]
            hours = d["secs"] / 3600 if d["secs"] else None
            row["driving_hours"] = round(hours, 1) if hours else None
            row["avg_speed_kmh"] = (
                round(d["km"] / hours, 1) if hours and d["km"] else None
            )
            if d["km"]:
                row["l_per_100km"] = round(100 * d["fuel_l"] / d["km"], 2)
                if row.get("distance_km") is not None:
                    row["fuel_l_est"] = round(
                        row["distance_km"] * row["l_per_100km"] / 100, 1
                    )
        if key in events:
            row["warning_events"] = events[key]["n"]
            row["warning_codes"] = codes.get(key, {}).get("n", 0)
        if key in readouts:
            row["fault_readouts"] = readouts[key]["n"]
            row["distinct_faults"] = faults.get(key, {}).get("n", 0)
            row["new_faults"] = new_faults.get(key, {}).get("n", 0)
        t = tires.get(key)
        if t and t["avg_kpa"] is not None:
            row["tire_avg_kpa"] = round(t["avg_kpa"], 1)
            row["tire_min_kpa"] = t["min_kpa"]
        out.append(row)
    return out
