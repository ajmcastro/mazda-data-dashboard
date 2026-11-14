"""Fill-ups (PLAN.md M47): the rises of the fuel level between two status snapshots (``v_refuels``), with what
the owner noted paying for them (``ref_fuel_paid``, from ``fuel_log.yaml``).

The same SQL runs in the phone app (``mobile/src/engine/refuels.ts``): keep the two identical. A payment is
matched by its date: it goes to the earliest fill-up whose two snapshots' local days span that date, and a
fill-up adds up the payments it got (two visits to the pump between two reports are one rise of the gauge).
Estimates and amounts paid are never mixed: the totals give both, and how many fill-ups have a payment."""

import duckdb

from . import models as m
from .dates import DateRange
from .db import has_table, one, rows

# every payment with the fill-up it belongs to (NULL: no fill-up was seen around that date)
MATCHED = (
    "WITH pay AS (SELECT row_number() OVER (ORDER BY paid_on, paid, litres) AS n, paid_on, paid, litres "
    "FROM ref_fuel_paid), matched AS (SELECT p.n, p.paid_on, p.paid, p.litres, "
    "(SELECT min(r.after_at) FROM v_refuels r "
    "WHERE p.paid_on BETWEEN r.local_day_before AND r.local_day_after) AS after_at FROM pay p) "
)
NO_PAYMENTS = (
    "WITH matched AS (SELECT CAST(NULL AS BIGINT) AS n, CAST(NULL AS DATE) AS paid_on, "
    "CAST(NULL AS DOUBLE) AS paid, CAST(NULL AS DOUBLE) AS litres, CAST(NULL AS TIMESTAMP) AS after_at "
    "WHERE false) "
)
FILL_UPS = (
    ", per AS (SELECT after_at, round(sum(paid), 2) AS paid, round(sum(litres), 1) AS paid_litres, "
    "count(*) AS payments FROM matched WHERE after_at IS NOT NULL GROUP BY after_at), "
    "f AS (SELECT r.before_at, r.after_at, r.level_before, r.level_after, r.points, r.gap_hours, "
    "r.odometer_km, r.doubtful, r.litres, r.km_since_previous, r.used_since_previous_l, "
    "r.l_per_100km_since_previous, r.est_cost, per.paid, per.paid_litres, "
    "coalesce(per.payments, 0) AS payments FROM v_refuels r LEFT JOIN per ON per.after_at = r.after_at {where}) "
)


def refuels(con: duckdb.DuckDBPyConnection, rng: DateRange) -> m.Refuels:
    where, params = rng.clause("r.after_at")
    base = (
        MATCHED if has_table(con, "ref_fuel_paid") else NO_PAYMENTS
    ) + FILL_UPS.format(where=where)
    settings = one(
        con,
        "SELECT try_cast(max(value) FILTER (WHERE key = 'tank_litres') AS DOUBLE) AS tank_litres, "
        "coalesce(try_cast(max(value) FILTER (WHERE key = 'refuel_min_points') AS DOUBLE), 15) AS min_points, "
        "max(value) FILTER (WHERE key = 'fuel_currency') AS currency FROM ref_settings",
    )
    totals = one(
        con,
        base
        + "SELECT count(*) AS fill_ups, count(*) FILTER (WHERE doubtful) AS doubtful, "
        "round(sum(litres), 1) AS litres, round(sum(est_cost), 2) AS est_cost, round(sum(paid), 2) AS paid, "
        "count(*) FILTER (WHERE payments > 0) AS paid_fill_ups FROM f",
        params,
    )
    listed = rows(con, base + "SELECT * FROM f ORDER BY after_at DESC", params)
    # a payment on a day of the period that no fill-up was seen around
    conds, day_params = [], []
    if rng.start:
        conds.append("paid_on >= CAST(? AS DATE)")
        day_params.append(rng.start.isoformat())
    if rng.end:
        conds.append("paid_on <= CAST(? AS DATE)")
        day_params.append(rng.end.isoformat())
    unmatched = rows(
        con,
        base
        + "SELECT paid_on, paid, litres FROM matched WHERE after_at IS NULL "
        + "".join(f"AND {c} " for c in conds)
        + "ORDER BY paid_on, n",
        [*params, *day_params],
    )
    return m.Refuels(refuels=listed, unmatched=unmatched, **settings, **totals)
