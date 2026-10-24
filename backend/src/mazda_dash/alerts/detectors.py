"""One detector per rule. Each reads the model views and returns alert candidates;
the engine decides which are new. Timestamps are naive UTC."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

import duckdb

from .config import AlertsConfig
from .store import Candidate


@dataclass
class Context:
    con: duckdb.DuckDBPyConnection
    cfg: AlertsConfig
    as_of: datetime  # time of the most recent data point
    now: datetime  # wall clock (naive UTC)

    @property
    def since(self) -> datetime:
        return self.as_of - timedelta(days=self.cfg.lookback_days)


def _stamp(t: datetime) -> str:
    return t.strftime("%Y%m%dT%H%M%S")


def _fmt(t: datetime | None) -> str:
    return t.strftime("%Y-%m-%d %H:%M UTC") if t else "unknown time"


def _g(v: float | None) -> str:
    return f"{v:g}" if v is not None else "unknown"


def _km(v: float | None) -> str:
    return f"{v:,.0f} km" if v is not None else "unknown odometer"


def new_dtc(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.new_dtc
    rows = ctx.con.execute(
        """SELECT ecu, dtc_code, failure_type, any_value(title), any_value(severity),
                  min(event_at), min_by(odometer_km, event_at), bool_or(known)
           FROM v_dtc_events GROUP BY ecu, dtc_code, failure_type
           HAVING min(event_at) >= ? ORDER BY min(event_at)""",
        [ctx.since],
    ).fetchall()
    out = []
    for ecu, code, ft, title, sev, first, odo, known in rows:
        hint = (
            "" if known else " No description yet: add one in config/codes/dtcs.yaml."
        )
        out.append(
            Candidate(
                "new_dtc",
                f"new_dtc:{ecu}:{code}:{ft}",
                sev if sev in ("info", "warning", "critical") else rule.severity,
                f"New fault {code}:{ft} on {ecu}",
                f"{title}. First reported {_fmt(first)} at {_km(odo)}.{hint}",
                first,
                "/faults",
            )
        )
    return out


def recurring_dtc(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.recurring_dtc
    rows = ctx.con.execute(
        """SELECT ecu, dtc_code, failure_type, title, readouts, first_seen, last_seen
           FROM v_dtc_frequency
           WHERE active_in_latest_readout AND readouts >= ?""",
        [rule.min_readouts],
    ).fetchall()
    return [
        Candidate(
            "recurring_dtc",
            f"recurring_dtc:{ecu}:{code}:{ft}",
            rule.severity,
            f"Recurring fault {code}:{ft} on {ecu}",
            f"{title}. Listed in {n} read-outs since {_fmt(first)}; still present in the latest one.",
            last,
            "/faults",
        )
        for ecu, code, ft, title, n, first, last in rows
    ]


def new_warning_code(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.new_warning_code
    rows = ctx.con.execute(
        """SELECT code, title, severity, events, first_seen FROM v_warning_frequency
           WHERE first_seen >= ? ORDER BY first_seen""",
        [ctx.since],
    ).fetchall()
    return [
        Candidate(
            "new_warning_code",
            f"new_warning_code:{code}",
            sev if sev in ("info", "warning", "critical") else rule.severity,
            f"New warning code {code}",
            f"{title}. First seen {_fmt(first)}; {n} event(s) so far.",
            first,
            "/warnings",
        )
        for code, title, sev, n, first in rows
        if code not in rule.ignore_codes
    ]


def warning_spike(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.warning_spike
    rows = ctx.con.execute(
        """WITH daily AS (
               SELECT code, CAST(triggered_at AS DATE) AS day, count(*)::DOUBLE AS c
               FROM v_warnings WHERE triggered_at IS NOT NULL GROUP BY 1, 2),
           span AS (
               SELECT date_diff('day', min(day), max(day)) + 1.0 AS days FROM daily),
           stats AS (
               SELECT code, sum(c) / (SELECT days FROM span) AS mean,
                      sqrt(greatest(sum(c * c) / (SELECT days FROM span)
                                    - pow(sum(c) / (SELECT days FROM span), 2), 0)) AS sd
               FROM daily GROUP BY code)
           SELECT d.code, d.day, d.c, s.mean, s.sd, f.title
           FROM daily d JOIN stats s USING (code) JOIN v_warning_frequency f USING (code)
           WHERE d.day >= CAST(? AS DATE) AND d.c >= ? AND d.c > s.mean + ? * s.sd
           ORDER BY d.day""",
        [ctx.since, rule.min_events, rule.sigma],
    ).fetchall()
    return [
        Candidate(
            "warning_spike",
            f"warning_spike:{code}:{day}",
            rule.severity,
            f"Warning {code} spiked on {day}",
            f"{int(c)} events in one day (usual: {mean:.1f}/day). {title}.",
            datetime(day.year, day.month, day.day),
            "/warnings",
        )
        for code, day, c, mean, _sd, title in rows
        if code not in rule.ignore_codes
    ]


def burglar_alarm(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.burglar_alarm
    rows = ctx.con.execute(
        """SELECT created_at, burglar_status, alarm_reason FROM v_alarm_events
           WHERE (burglar_status > 1 OR alarm_reason > 0) AND created_at >= ?
           ORDER BY created_at""",
        [ctx.since],
    ).fetchall()
    return [
        Candidate(
            "burglar_alarm",
            f"burglar_alarm:{_stamp(at)}",
            rule.severity,
            "Burglar alarm status raised",
            f"At {_fmt(at)} the alarm reported status {_g(status)}, reason {_g(reason)}. "
            "Check whether this was you (door lock, key fob, tow).",
            at,
            "/status",
        )
        for at, status, reason in rows
    ]


def high_consumption(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.high_consumption
    base = ctx.con.execute(
        "SELECT 100 * sum(fuel_l) / nullif(sum(km), 0) FROM v_trip_segments WHERE km > 0"
    ).fetchone()[0]
    if base is None:
        return []
    rows = ctx.con.execute(
        """SELECT end_at, km, fuel_l FROM v_trip_segments
           WHERE end_at >= ? AND km >= ? AND 100 * fuel_l / km > ? ORDER BY end_at""",
        [ctx.since, rule.min_km, rule.factor * base],
    ).fetchall()
    return [
        Candidate(
            "high_consumption",
            f"high_consumption:{_stamp(end)}",
            rule.severity,
            f"High fuel consumption: {100 * fuel / km:.1f} l/100 km",
            f"{km:.0f} km ending {_fmt(end)} used {fuel:.1f} l, "
            f"{100 * fuel / km / base:.1f}x your average of {base:.1f} l/100 km.",
            end,
            "/status",
        )
        for end, km, fuel in rows
    ]


def low_fuel(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.low_fuel
    row = ctx.con.execute(
        """SELECT created_at, fuel_level_pct, range_km FROM v_vehicle_status
           WHERE fuel_level_pct IS NOT NULL ORDER BY created_at DESC LIMIT 1"""
    ).fetchone()
    if not row or row[0] < ctx.since or row[1] >= rule.below_pct:
        return []
    at, pct, rng = row
    return [
        Candidate(
            "low_fuel",
            f"low_fuel:{at:%Y-%m-%d}",
            rule.severity,
            f"Low fuel: {pct:g}%",
            f"Fuel gauge at {pct:g}% on {_fmt(at)}"
            + (f", range about {rng:g} km." if rng is not None else "."),
            at,
            "/status",
        )
    ]


def low_tire_pressure(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.low_tire_pressure
    rows = ctx.con.execute(
        """WITH t AS (
               SELECT created_at, 'front left' AS wheel, tire_fl_kpa AS kpa FROM v_vehicle_status
               UNION ALL SELECT created_at, 'front right', tire_fr_kpa FROM v_vehicle_status
               UNION ALL SELECT created_at, 'rear left', tire_rl_kpa FROM v_vehicle_status
               UNION ALL SELECT created_at, 'rear right', tire_rr_kpa FROM v_vehicle_status)
           SELECT wheel, CAST(created_at AS DATE), min(kpa), min(created_at) FROM t
           WHERE kpa < ? AND created_at >= ? GROUP BY wheel, CAST(created_at AS DATE)
           ORDER BY 4""",
        [rule.min_kpa, ctx.since],
    ).fetchall()
    return [
        Candidate(
            "low_tire_pressure",
            f"low_tire_pressure:{wheel}:{day}",
            rule.severity,
            f"Low tire pressure ({wheel}): {kpa:g} kPa",
            f"The {wheel} tire read {kpa:g} kPa on {day}, below your {rule.min_kpa:g} kPa limit.",
            first,
            "/status",
        )
        for wheel, day, kpa, first in rows
    ]


def data_gap(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.data_gap
    gap = ctx.now - ctx.as_of
    if gap <= timedelta(days=rule.max_days):
        return []
    return [
        Candidate(
            "data_gap",
            f"data_gap:{ctx.as_of:%Y-%m-%d}",
            rule.severity,
            f"No new data for {gap.days} days",
            f"The latest data point is from {_fmt(ctx.as_of)}. Request a new export from Mazda "
            "and run `make ingest`.",
            ctx.as_of,
            "/",
        )
    ]


def oil_change_due(ctx: Context) -> list[Candidate]:
    """The car's own countdown (v_oil_readings) is at or below the limit. A state, so no lookback;
    one alert per service interval (a reset of the countdown starts a new interval)."""
    rule = ctx.cfg.rules.oil_change_due
    row = ctx.con.execute(
        """SELECT read_at, remaining_km, odometer_km, interval_started_at FROM v_oil_readings
           ORDER BY read_at DESC LIMIT 1"""
    ).fetchone()
    if not row or row[1] > rule.below_km:
        return []
    at, remaining, odo, started = row
    return [
        Candidate(
            "oil_change_due",
            f"oil_change_due:{_stamp(started)}",
            rule.severity,
            f"Oil change due soon: about {remaining:,.0f} km left",
            f"The car reported {remaining:,.0f} km until the next oil change on {_fmt(at)}"
            + (f" (odometer {_km(odo)})." if odo is not None else ".")
            + " It counts in steps of 1,000 km or more, so the real distance can be less.",
            at,
            "/status",
        )
    ]


DETECTORS: dict[str, Callable[[Context], list[Candidate]]] = {
    "new_dtc": new_dtc,
    "recurring_dtc": recurring_dtc,
    "new_warning_code": new_warning_code,
    "warning_spike": warning_spike,
    "burglar_alarm": burglar_alarm,
    "high_consumption": high_consumption,
    "low_fuel": low_fuel,
    "low_tire_pressure": low_tire_pressure,
    "data_gap": data_gap,
    "oil_change_due": oil_change_due,
}
