"""Fault comeback (PLAN.md M67): after a fault stops being listed, how soon it was read out again.

For each control unit, its read-outs are the ones where it answered (``kind`` ``none`` or ``fault``; a read error
says nothing about its faults). For each fault of that unit, walking its read-outs in time: a *wait* starts at
the first read-out that does not list the fault after one that did, and ends at the next read-out that lists it
again (``back``); a wait still open at the unit's newest read-out is *censored* there. The share still not back
after 7, 30 and 90 days and the median wait are a Kaplan–Meier estimate, given only from ``MIN_ENDED`` waits that
ended. Read-outs are taken when someone reads the car, so a wait is "between read-outs": the fault may have come
back earlier than the read-out that saw it.

The read-outs come from SQL; the walk and the estimate are plain Python, the same in the phone app
(``mobile/src/engine/comeback.ts``): keep the two identical. No logarithm or other function that could differ in
the last bit: only sums, products and divisions."""

import duckdb

from . import models as m
from .db import rows

MIN_ENDED = 3
DAYS = (7, 30, 90)

READINGS_SQL = (
    "SELECT d.ecu, coalesce(h.triggered_at, h.copied_at) AS read_at, d.transaction_id, d.kind, d.dtc_code "
    "FROM dtc_readings d JOIN dtc_headers h USING (transaction_id) "
    "WHERE d.kind IN ('none', 'fault') AND coalesce(h.triggered_at, h.copied_at) IS NOT NULL "
    "ORDER BY d.ecu, read_at, d.transaction_id, d.dtc_code"
)
TITLES_SQL = (
    "SELECT ecu, dtc_code, any_value(CASE WHEN known THEN title END) AS title FROM v_dtc_events "
    "GROUP BY ecu, dtc_code"
)


def _days(a, b) -> float:
    return (b - a).total_seconds() / 86400


def still_away(waits: list[tuple[float, bool]], t: float) -> float:
    """Kaplan–Meier: the share of waits still not back after ``t`` days (1.0 = none came back by then)."""
    share = 1.0
    times = sorted({d for d, back in waits if back and d <= t})
    for time in times:
        at_risk = sum(1 for d, _ in waits if d >= time)
        came_back = sum(1 for d, back in waits if back and d == time)
        share *= 1 - came_back / at_risk
    return share


def median_wait(waits: list[tuple[float, bool]]) -> float | None:
    """The first wait length at which half or more had come back, or None when the estimate never gets there."""
    for time in sorted({d for d, back in waits if back}):
        if still_away(waits, time) <= 0.5:
            return time
    return None


def fault_comeback(con: duckdb.DuckDBPyConnection) -> m.Comeback:
    readouts: dict[str, list[tuple]] = {}
    listed: dict[tuple[str, tuple], set[str]] = {}
    for r in rows(con, READINGS_SQL):
        key = (r["read_at"], r["transaction_id"])
        units = readouts.setdefault(r["ecu"], [])
        if not units or units[-1] != key:
            units.append(key)
        codes = listed.setdefault((r["ecu"], key), set())
        if r["kind"] == "fault":
            codes.add(r["dtc_code"])
    titles = {(r["ecu"], r["dtc_code"]): r["title"] for r in rows(con, TITLES_SQL)}
    faults = []
    for ecu in sorted(readouts):
        seq = readouts[ecu]
        codes = sorted(set().union(*(listed[(ecu, k)] for k in seq)))
        for code in codes:
            waits, start, seen, times_listed, first, last = (
                [],
                None,
                False,
                0,
                None,
                None,
            )
            for k in seq:
                if code in listed[(ecu, k)]:
                    times_listed += 1
                    first = first or k[0]
                    last = k[0]
                    if start is not None:
                        waits.append(
                            {
                                "from_at": start,
                                "to_at": k[0],
                                "days": round(_days(start, k[0]), 1),
                                "back": True,
                            }
                        )
                        start = None
                    seen = True
                elif seen and start is None:
                    start = k[0]
            if start is not None:
                waits.append(
                    {
                        "from_at": start,
                        "to_at": None,
                        "days": round(_days(start, seq[-1][0]), 1),
                        "back": False,
                    }
                )
            exact = []
            for w in waits:  # the estimate uses the unrounded lengths
                end = w["to_at"] or seq[-1][0]
                exact.append((_days(w["from_at"], end), w["back"]))
            ended = sum(1 for w in waits if w["back"])
            enough = ended >= MIN_ENDED
            median = median_wait(exact) if enough else None
            faults.append(
                {
                    "ecu": ecu,
                    "dtc_code": code,
                    "title": titles.get((ecu, code)),
                    "readouts": len(seq),
                    "listed": times_listed,
                    "first_at": first,
                    "last_listed_at": last,
                    "last_read_at": seq[-1][0],
                    "listed_now": code in listed[(ecu, seq[-1])],
                    "waits": waits,
                    "ended": ended,
                    "enough": enough,
                    "still_away": [
                        {"days": t, "pct": round(100 * still_away(exact, t), 1)}
                        for t in DAYS
                    ]
                    if enough
                    else [],
                    "median_days": round(median, 1) if median is not None else None,
                }
            )
    faults.sort(key=lambda f: (-f["listed"], f["ecu"], f["dtc_code"]))
    return m.Comeback(min_ended=MIN_ENDED, faults=faults)
