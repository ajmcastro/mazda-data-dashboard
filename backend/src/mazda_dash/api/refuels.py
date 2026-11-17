"""Fill-ups (PLAN.md M47): the rises of the fuel level between two status snapshots (``v_refuels``), with what
the owner noted paying for them (``ref_fuel_paid``, from ``fuel_log.yaml``).

The same SQL runs in the phone app (``mobile/src/engine/refuels.ts``): keep the two identical. A payment is
matched with a score (M70): every fill-up up to ``MAX_DAYS_OFF`` days from its date is a candidate, ``days_off``
being 0 when the date lies between the two snapshots' local days; the litres paid and the litres the gauge saw
agree when the gauge saw ``LITRES_LOW`` to ``LITRES_HIGH`` times what was paid (the gauge's figure is a lower bound:
fuel burned between the two reports is not seen). The cost is ten per day off, plus five when the litres
disagree; the payment goes to its cheapest candidate (ties: the earliest). ``confidence``: high on the right days
with litres that agree or are unknown, medium on the right days with litres that disagree or a day off with
litres that agree, low otherwise. A fill-up still adds up the payments it got (two visits to the pump between
two reports are one rise of the gauge), and takes the lowest confidence among them.
Estimates and amounts paid are never mixed: the totals give both, and how many fill-ups have a payment."""

import duckdb

from . import models as m
from .dates import DateRange
from .db import has_table, one, rows

MAX_DAYS_OFF = 3
LITRES_LOW = 0.6
LITRES_HIGH = 1.15

# every payment with the fill-up it belongs to (NULL: no fill-up within MAX_DAYS_OFF days), scored
MATCHED = (
    "WITH pay AS (SELECT row_number() OVER (ORDER BY paid_on, paid, litres) AS n, paid_on, paid, litres "
    "FROM ref_fuel_paid), "
    "cand AS (SELECT p.n, r.after_at, CASE WHEN p.paid_on BETWEEN r.local_day_before AND r.local_day_after THEN 0 "
    "ELSE least(abs(date_diff('day', p.paid_on, r.local_day_before)), "
    "abs(date_diff('day', p.paid_on, r.local_day_after))) END AS days_off, "
    "CASE WHEN p.litres IS NULL OR r.litres IS NULL OR p.litres <= 0 THEN NULL "
    f"ELSE r.litres / p.litres BETWEEN {LITRES_LOW} AND {LITRES_HIGH} END AS litres_ok "
    "FROM pay p CROSS JOIN v_refuels r), "
    "ranked AS (SELECT *, row_number() OVER (PARTITION BY n ORDER BY days_off * 10 + "
    "CASE WHEN litres_ok = false THEN 5 ELSE 0 END, after_at) AS k "
    f"FROM cand WHERE days_off <= {MAX_DAYS_OFF}), "
    "matched AS (SELECT p.n, p.paid_on, p.paid, p.litres, b.after_at, b.days_off, b.litres_ok, "
    "CASE WHEN b.after_at IS NULL THEN NULL "
    "WHEN b.days_off = 0 AND coalesce(b.litres_ok, true) THEN 'high' "
    "WHEN b.days_off = 0 OR (b.days_off = 1 AND coalesce(b.litres_ok, true)) THEN 'medium' "
    "ELSE 'low' END AS confidence FROM pay p LEFT JOIN ranked b ON b.n = p.n AND b.k = 1) "
)
NO_PAYMENTS = (
    "WITH matched AS (SELECT CAST(NULL AS BIGINT) AS n, CAST(NULL AS DATE) AS paid_on, "
    "CAST(NULL AS DOUBLE) AS paid, CAST(NULL AS DOUBLE) AS litres, CAST(NULL AS TIMESTAMP) AS after_at, "
    "CAST(NULL AS BIGINT) AS days_off, CAST(NULL AS BOOLEAN) AS litres_ok, CAST(NULL AS VARCHAR) AS confidence "
    "WHERE false) "
)
FILL_UPS = (
    ", per AS (SELECT after_at, round(sum(paid), 2) AS paid, round(sum(litres), 1) AS paid_litres, "
    "count(*) AS payments, max(days_off) AS days_off, bool_or(litres_ok = false) AS litres_differ, "
    "CASE WHEN bool_or(confidence = 'low') THEN 'low' WHEN bool_or(confidence = 'medium') THEN 'medium' "
    "ELSE 'high' END AS confidence FROM matched WHERE after_at IS NOT NULL GROUP BY after_at), "
    "f AS (SELECT r.before_at, r.after_at, r.level_before, r.level_after, r.points, r.gap_hours, "
    "r.odometer_km, r.doubtful, r.litres, r.km_since_previous, r.used_since_previous_l, "
    "r.l_per_100km_since_previous, r.est_cost, per.paid, per.paid_litres, "
    "coalesce(per.payments, 0) AS payments, per.days_off, coalesce(per.litres_differ, false) AS litres_differ, "
    "per.confidence FROM v_refuels r LEFT JOIN per ON per.after_at = r.after_at {where}) "
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
