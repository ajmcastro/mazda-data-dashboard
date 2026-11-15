"""Maintenance and mileage forecast (PLAN.md M52): one SQL shared by the API route, the All cars card and the
oil alert, so they cannot disagree. The phone runs the same text (``mobile/src/engine/forecast.ts``).

Everything is counted from the NEWEST DAY WITH DATA, never from today: the exports can be old.

* **Pace**: kilometres a day over the last 30 and the last 90 days, from the odometer (the newest reading
  against the first reading inside the window). A pace is given only when the readings span at least half its
  window; under ``MIN_PACE`` km a day it gives no date.
* **Oil change**: the car's own countdown (``v_oil_readings``) less what was driven since it was read, divided
  by each pace: two dates, the earlier and the later. Withheld for a car that sends no countdown.
* **The year**: with ``mileage`` in settings.yaml (``mileage_limit_km``, ``mileage_start`` in
  ``ref_settings``), the year is the one from the anniversary of the start date that contains the newest day;
  the distance so far is the odometer now less the first reading on or after that anniversary, and the
  projection adds the 90-day pace (the 30-day one without it) for the days left."""

MIN_PACE = 1.0
MAX_DAYS = 730
ZONE = "coalesce((SELECT max(value) FILTER (WHERE key = 'car_timezone') FROM ref_settings), 'UTC')"


def _window(days: int) -> str:
    return (
        f"p{days} AS (SELECT (SELECT min(o.read_at) FROM o WHERE o.read_at >= n.t - INTERVAL {days} DAY) AS from_t, "
        f"(SELECT arg_min(o.odometer_km, o.read_at) FROM o WHERE o.read_at >= n.t - INTERVAL {days} DAY) AS from_km "
        "FROM n), "
        f"q{days} AS (SELECT CASE WHEN date_diff('second', p.from_t, n.t) / 86400.0 >= {days / 2:g} "
        f"THEN (n.km - p.from_km) / (date_diff('second', p.from_t, n.t) / 86400.0) END AS pace FROM p{days} p, n), "
    )


def _days(pace: str) -> str:
    """Days until the oil change at a pace (NULL without a pace worth a date, or beyond MAX_DAYS)."""
    return (
        f"CASE WHEN {pace} >= {MIN_PACE} AND oil.left_km IS NOT NULL AND oil.left_km / {pace} <= {MAX_DAYS} "
        f"THEN CAST(ceil(oil.left_km / {pace}) AS INTEGER) END"
    )


FORECAST_SQL = (
    "WITH o AS (SELECT read_at, odometer_km FROM v_odometer_readings WHERE odometer_km IS NOT NULL), "
    "n AS (SELECT max(read_at) AS t, arg_max(odometer_km, read_at) AS km, "
    f"CAST(timezone({ZONE}, make_timestamptz(epoch_us(max(read_at)))) AS DATE) AS day FROM o), "
    + _window(30)
    + _window(90)
    + "latest AS (SELECT remaining_km, odometer_km FROM v_oil_readings ORDER BY read_at DESC LIMIT 1), "
    "oil AS (SELECT (SELECT greatest(l.remaining_km - greatest(n.km - coalesce(l.odometer_km, n.km), 0), 0) "
    "FROM latest l) AS left_km FROM n), "
    f"d AS (SELECT {_days('q30.pace')} AS d30, {_days('q90.pace')} AS d90 FROM oil, q30, q90), "
    "cfg AS (SELECT try_cast(max(value) FILTER (WHERE key = 'mileage_limit_km') AS DOUBLE) AS limit_km, "
    "try_cast(max(value) FILTER (WHERE key = 'mileage_start') AS DATE) AS start FROM ref_settings), "
    "y AS (SELECT c.limit_km, CASE WHEN c.start IS NOT NULL AND n.day >= c.start "
    "THEN CAST(c.start + to_years(CAST(date_sub('year', c.start, n.day) AS INTEGER)) AS DATE) END AS a, "
    "CASE WHEN c.start IS NOT NULL AND n.day >= c.start "
    "THEN CAST(c.start + to_years(CAST(date_sub('year', c.start, n.day) AS INTEGER) + 1) AS DATE) END AS e "
    "FROM cfg c, n), "
    "ys AS (SELECT (SELECT arg_min(o.odometer_km, o.read_at) FROM o WHERE CAST(timezone("
    f"{ZONE}, make_timestamptz(epoch_us(o.read_at))) AS DATE) >= y.a) AS km0, "
    f"(SELECT min(CAST(timezone({ZONE}, make_timestamptz(epoch_us(o.read_at))) AS DATE)) FROM o "
    f"WHERE CAST(timezone({ZONE}, make_timestamptz(epoch_us(o.read_at))) AS DATE) >= y.a) AS day0 FROM y), "
    "r AS (SELECT n.day, n.km, q30.pace AS p30, q90.pace AS p90, coalesce(q90.pace, q30.pace) AS pace, "
    "oil.left_km, least(d.d30, d.d90) AS first_days, greatest(d.d30, d.d90) AS last_days, "
    "y.limit_km, y.a, y.e, ys.km0, ys.day0 FROM n, q30, q90, oil, d, y, ys) "
    "SELECT strftime(day, '%Y-%m-%d') AS as_of, round(km, 1) AS odometer_km, "
    "round(p30, 1) AS km_per_day_30d, round(p90, 1) AS km_per_day_90d, "
    "CAST(round(pace * 365, -2) AS INTEGER) AS km_per_year, "
    "round(left_km, 0) AS oil_left_km, first_days AS oil_days_first, last_days AS oil_days_last, "
    "strftime(day + first_days, '%Y-%m-%d') AS oil_date_first, "
    "strftime(day + last_days, '%Y-%m-%d') AS oil_date_last, "
    "limit_km AS mileage_limit_km, strftime(a, '%Y-%m-%d') AS year_start, strftime(e, '%Y-%m-%d') AS year_end, "
    "CASE WHEN a IS NOT NULL THEN round(km - km0, 0) END AS year_km, "
    "CASE WHEN day0 > a + 7 THEN strftime(day0, '%Y-%m-%d') END AS year_counted_from, "
    "CASE WHEN a IS NOT NULL AND pace IS NOT NULL "
    "THEN CAST(round(km - km0 + pace * date_diff('day', day, e), -2) AS INTEGER) END AS year_projected_km, "
    "CASE WHEN a IS NOT NULL AND pace IS NOT NULL AND limit_km IS NOT NULL "
    "THEN CAST(round(km - km0 + pace * date_diff('day', day, e), -2) - limit_km AS INTEGER) END AS year_over_km "
    "FROM r WHERE day IS NOT NULL"
)
