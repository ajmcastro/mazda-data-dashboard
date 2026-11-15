"""Tire leak forecast (PLAN.md M51): the SQL shared by the API route and the alert rule.

Per wheel, the DIFFERENCE between that wheel and the mean of the other three at each measurement
(``v_tire_readings``: measurements, not snapshots). Temperature moves all four together, so it cancels out.
The slope of that difference over the last ``WINDOW_DAYS`` is a Theil-Sen estimate (the median of the slopes
between every pair of measurements at least a day apart), which a single odd reading cannot move. A refill
restarts the series: from one measurement to the next the wheel's own pressure rose by ``REFILL_KPA`` or more
AND it rose by ``REFILL_AGAINST_KPA`` or more against the others (both, because the car reports in steps of 5 or
10 kPa and one step up is not a refill). A forecast needs ``MIN_READINGS`` measurements over ``MIN_SPAN_DAYS``; a wheel counts as losing
pressure from ``MIN_LOSS_PER_WEEK`` kPa a week; the date is when the wheel's own newest pressure reaches the
limit at that rate, given only when it is within ``HORIZON_DAYS``.

The one parameter (``?``) is the limit in kPa. The phone runs the same text (``mobile/src/engine/tires.ts``)."""

WINDOW_DAYS = 30
MIN_READINGS = 8
MIN_SPAN_DAYS = 10
REFILL_KPA = 25
REFILL_AGAINST_KPA = 20
MIN_LOSS_PER_WEEK = 1.0
HORIZON_DAYS = 365

WHEELS = ("fl", "fr", "rl", "rr")


def _wheel(i: int, name: str) -> str:
    others = " + ".join(f"tire_{w}_kpa" for w in WHEELS if w != name)
    return (
        f"SELECT reading_at, '{name}' AS wheel, {i} AS ord, tire_{name}_kpa AS own, "
        f"tire_{name}_kpa - ({others}) / 3.0 AS d FROM r"
    )


FORECAST_SQL = (
    "WITH r AS (SELECT reading_at, tire_fl_kpa, tire_fr_kpa, tire_rl_kpa, tire_rr_kpa FROM v_tire_readings "
    "WHERE time_known AND tire_fl_kpa IS NOT NULL AND tire_fr_kpa IS NOT NULL AND tire_rl_kpa IS NOT NULL "
    "AND tire_rr_kpa IS NOT NULL), "
    "newest AS (SELECT max(reading_at) AS t FROM r), "
    "w AS (" + " UNION ALL ".join(_wheel(i, n) for i, n in enumerate(WHEELS)) + "), "
    f"recent AS (SELECT w.* FROM w CROSS JOIN newest n WHERE w.reading_at >= n.t - INTERVAL {WINDOW_DAYS} DAY), "
    "j AS (SELECT *, d - lag(d) OVER (PARTITION BY wheel ORDER BY reading_at) AS jump, "
    "own - lag(own) OVER (PARTITION BY wheel ORDER BY reading_at) AS rise FROM recent), "
    f"s AS (SELECT *, max(CASE WHEN rise >= {REFILL_KPA} AND jump >= {REFILL_AGAINST_KPA} THEN reading_at END) "
    "OVER (PARTITION BY wheel) "
    "AS restart FROM j), "
    "k AS (SELECT * FROM s WHERE restart IS NULL OR reading_at >= restart), "
    "stat AS (SELECT wheel, ord, count(*) AS n, "
    "date_diff('second', min(reading_at), max(reading_at)) / 86400.0 AS span_days, "
    "arg_max(own, reading_at) AS current_kpa, max(reading_at) AS last_at, max(restart) AS refilled_at "
    "FROM k GROUP BY wheel, ord), "
    "slope AS (SELECT a.wheel, median((b.d - a.d) / (date_diff('second', a.reading_at, b.reading_at) / 86400.0)) "
    "AS per_day FROM k a JOIN k b ON a.wheel = b.wheel AND b.reading_at >= a.reading_at + INTERVAL 1 DAY "
    "GROUP BY a.wheel), "
    "f AS (SELECT st.wheel, st.ord, st.n, st.span_days, st.current_kpa, st.last_at, st.refilled_at, "
    f"st.n >= {MIN_READINGS} AND st.span_days >= {MIN_SPAN_DAYS} AND sl.per_day IS NOT NULL AS enough, "
    "sl.per_day * 7 AS per_week, CAST(? AS DOUBLE) AS limit_kpa "
    "FROM stat st LEFT JOIN slope sl ON sl.wheel = st.wheel), "
    f"g AS (SELECT *, enough AND per_week <= -{MIN_LOSS_PER_WEEK} AS losing, "
    f"CASE WHEN enough AND per_week <= -{MIN_LOSS_PER_WEEK} AND current_kpa > limit_kpa "
    "THEN (current_kpa - limit_kpa) / (-per_week / 7.0) END AS days_left FROM f) "
    "SELECT wheel, n AS measurements, round(span_days, 1) AS span_days, current_kpa, last_at, refilled_at, "
    "enough, CASE WHEN enough THEN round(per_week, 1) END AS kpa_per_week, coalesce(losing, false) AS losing, "
    "coalesce(losing AND current_kpa <= limit_kpa, false) AS below_limit, "
    f"CASE WHEN days_left <= {HORIZON_DAYS} THEN CAST(ceil(days_left) AS INTEGER) END AS days_left, "
    f"CASE WHEN days_left <= {HORIZON_DAYS} THEN strftime(last_at + to_days(CAST(ceil(days_left) AS INTEGER)), "
    "'%Y-%m-%d') END AS reaches_limit_on FROM g ORDER BY ord"
)
