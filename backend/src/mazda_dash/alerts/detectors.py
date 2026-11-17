"""One detector per rule. Each reads the model views and returns alert candidates;
the engine decides which are new. Timestamps are naive UTC."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

import duckdb

from ..forecast import FORECAST_SQL as PACE_SQL
from ..tires import FORECAST_SQL
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
            ""
            if known
            else " No description yet: add one in the model's codes/dtcs.yaml (config/models/<id>/)."
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


WHEEL_NAMES = {
    "fl": "front left",
    "fr": "front right",
    "rl": "rear left",
    "rr": "rear right",
}


def tire_leak_forecast(ctx: Context) -> list[Candidate]:
    """A wheel losing pressure against the other three that reaches the limit within `days` (M51): once per
    wheel and forecast date's week, so a forecast that keeps moving does not raise an alert a day."""
    rule = ctx.cfg.rules.tire_leak_forecast
    limit = ctx.cfg.rules.low_tire_pressure.min_kpa
    cur = ctx.con.execute(FORECAST_SQL, [limit])
    names = [d[0] for d in cur.description]
    out = []
    for row in cur.fetchall():
        r = dict(zip(names, row, strict=True))
        if not r["losing"] or r["days_left"] is None or r["days_left"] > rule.days:
            continue
        wheel = WHEEL_NAMES[r["wheel"]]
        out.append(
            Candidate(
                "tire_leak_forecast",
                f"tire_leak_forecast:{r['wheel']}:{_stamp(r['refilled_at'] or datetime.min)}",
                rule.severity,
                f"Tire losing pressure ({wheel}): about {r['days_left']} days to the limit",
                f"The {wheel} tire is losing about {-r['kpa_per_week']:g} kPa a week against the other three. "
                f"At this rate it reaches your {limit:g} kPa limit around {r['reaches_limit_on']} "
                f"(it read {r['current_kpa']:g} kPa; based on {r['measurements']} measurements over "
                f"{r['span_days']:g} days).",
                r["last_at"],
                "/status",
            )
        )
    return out


OPEN_WORDS = {
    "door_driver": "driver door",
    "door_passenger": "passenger door",
    "door_rear_left": "rear left door",
    "door_rear_right": "rear right door",
    "trunk": "trunk",
    "hood": "hood",
    "hazard": "hazard lights",
}
UNUSUAL_SQL = (
    "SELECT r.created_at, r.kind, r.feature, r.value, r.label, r.share_pct, r.usual_low, r.usual_high, "
    "strftime(timezone(c.zone, make_timestamptz(epoch_us(r.created_at))), '%Y-%m-%d %H:%M') AS local "
    "FROM v_unusual_reasons r CROSS JOIN (SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), "
    "'UTC') AS zone FROM ref_settings) c WHERE r.created_at >= ? ORDER BY r.created_at, r.kind, r.feature"
)
UNUSUAL_END = "Unlike this car's other reports; a hint, not a diagnosis."


def _unusual_text(r: dict) -> tuple[str, str, str]:
    """(key part, title, detail) of one reason a report is unusual (M64)."""
    at = f"At {r['local']} (car's local time)"
    v, lo, hi = r["value"], r["usual_low"], r["usual_high"]
    if r["feature"] == "fuel_drop_parked":
        return (
            f"{v:g}",
            f"Unusual report: the fuel level fell {v:g} points while parked",
            (
                f"{at} the fuel level was {v:g} points lower than in the report before while the odometer "
                f"did not move; usually it falls by {lo:g} to {hi:g} points. {UNUSUAL_END}"
            ),
        )
    if r["feature"] == "tire_spread":
        return (
            f"{v:g}",
            f"Unusual report: tire pressures {v:g} kPa apart",
            (
                f"{at} the highest and lowest tire pressures were {v:g} kPa apart; usually {lo:g} to "
                f"{hi:g} kPa. {UNUSUAL_END}"
            ),
        )
    if r["feature"] == "hour":
        kind = "status" if r["kind"] == "status" else "door"
        return (
            f"{v:g}",
            f"Unusual report at {r['local'][11:]} (car's local time)",
            (
                f"The car sent a report at {r['local']} (car's local time), an hour with "
                f"{r['share_pct']:g}% of its {kind} reports. {UNUSUAL_END}"
            ),
        )
    parts = ", ".join(OPEN_WORDS.get(p, p) for p in (r["label"] or "").split(","))
    return (
        (r["label"] or "").replace(",", "+"),
        f"Unusual report: {parts} open",
        f"{at} the car reported {parts} open, as in {r['share_pct']:g}% of its door reports. {UNUSUAL_END}",
    )


def unusual_report(ctx: Context) -> list[Candidate]:
    """A status or door report unlike the car's other reports (M64, v_unusual_reasons): one alert per reason.
    Off by default."""
    rule = ctx.cfg.rules.unusual_report
    cur = ctx.con.execute(UNUSUAL_SQL, [ctx.since])
    names = [d[0] for d in cur.description]
    out = []
    for row in cur.fetchall():
        r = dict(zip(names, row, strict=True))
        key, title, detail = _unusual_text(r)
        out.append(
            Candidate(
                "unusual_report",
                f"unusual_report:{r['feature']}:{key}:{_stamp(r['created_at'])}",
                rule.severity,
                title,
                detail,
                r["created_at"],
                "/status",
            )
        )
    return out


def low_tire_pressure(ctx: Context) -> list[Candidate]:
    rule = ctx.cfg.rules.low_tire_pressure
    # keyed on when the car MEASURED the pressure (v_tire_readings), so one low reading that appears in
    # several snapshots is one alert
    rows = ctx.con.execute(
        """WITH t AS (
               SELECT reading_at, 'front left' AS wheel, tire_fl_kpa AS kpa FROM v_tire_readings
               UNION ALL SELECT reading_at, 'front right', tire_fr_kpa FROM v_tire_readings
               UNION ALL SELECT reading_at, 'rear left', tire_rl_kpa FROM v_tire_readings
               UNION ALL SELECT reading_at, 'rear right', tire_rr_kpa FROM v_tire_readings)
           SELECT wheel, CAST(reading_at AS DATE), min(kpa), min(reading_at) FROM t
           WHERE kpa < ? AND reading_at >= ? GROUP BY wheel, CAST(reading_at AS DATE)
           ORDER BY 4, 1""",
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


def low_battery_frame(ctx: Context) -> list[Candidate]:
    """A freeze frame recorded while a supply voltage was below the limit: one alert per fault (the lowest
    reading of its frames inside the lookback window). A hint worth a look at the battery, not a diagnosis."""
    rule = ctx.cfg.rules.low_battery_frame
    rows = ctx.con.execute(
        """SELECT ecu, dtc_code, min(value_num) AS volts,
                  min_by(signal, value_num) AS signal, min(coalesce(triggered_at, snapshot_at)) AS at
           FROM v_frame_signals
           WHERE signal IN ('Main_ECU_Voltage_Supply', 'ECU_Power_Voltage')
                 AND value_num > 0 AND value_num < ? AND coalesce(triggered_at, snapshot_at) >= ?
           GROUP BY ecu, dtc_code ORDER BY 5, 1, 2""",
        [rule.min_voltage, ctx.since],
    ).fetchall()
    return [
        Candidate(
            "low_battery_frame",
            f"low_battery_frame:{ecu}:{code}",
            rule.severity,
            f"Low voltage in a fault's freeze frame ({ecu} {code}): {volts:g} V",
            f"The freeze frame of fault {ecu} {code} recorded {volts:g} V ({signal}), below your "
            f"{rule.min_voltage:g} V limit. Worth a look at the battery; a hint, not a diagnosis.",
            at,
            "/faults",
        )
        for ecu, code, volts, signal, at in rows
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
    if not row:
        return []
    soon = None  # the forecast's earlier date, when the rule asks for a warning by days
    if row[1] > rule.below_km:
        if rule.days is None:
            return []
        cur = ctx.con.execute(PACE_SQL)
        names = [d[0] for d in cur.description]
        ahead = cur.fetchone()
        found = dict(zip(names, ahead, strict=True)) if ahead else {}
        if found.get("oil_days_first") is None or found["oil_days_first"] > rule.days:
            return []
        soon = found
    at, remaining, odo, started = row
    if soon:
        return [
            Candidate(
                "oil_change_due",
                f"oil_change_due:{_stamp(started)}",
                rule.severity,
                f"Oil change in about {soon['oil_days_first']} days at your recent pace",
                f"About {soon['oil_left_km']:,.0f} km are left on the car's countdown. At the pace of the last "
                f"30 and 90 days that is between {soon['oil_date_first']} and {soon['oil_date_last']}, counted "
                f"from {soon['as_of']}. The countdown moves in steps of 1,000 km or more.",
                at,
                "/status",
            )
        ]
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


def car_warning_flag(ctx: Context) -> list[Candidate]:
    """One alert per run in which one of the car's own warning flags was on (v_car_warning_episodes).
    Event-based: runs that began before the lookback window are not raised."""
    rule = ctx.cfg.rules.car_warning_flag
    rows = ctx.con.execute(
        """SELECT flag, label, started_at, last_on_at, readings, max_value, ongoing
           FROM v_car_warning_episodes WHERE started_at >= ? ORDER BY started_at, flag""",
        [ctx.since],
    ).fetchall()
    out = []
    for flag, label, started, last, n, value, ongoing in rows:
        if flag in rule.ignore_flags:
            continue
        span = (
            f"since {_fmt(started)}"
            if ongoing
            else f"from {_fmt(started)} to {_fmt(last)}"
        )
        out.append(
            Candidate(
                "car_warning_flag",
                f"car_warning_flag:{flag}:{_stamp(started)}",
                rule.severities.get(flag, rule.severity),
                f"The car reports a warning: {label}",
                f"The car's own warning flag ({flag}) was on {span} ({n} reading"
                f"{'' if n == 1 else 's'}, raw value {_g(value)}). This is the car's flag, not a "
                "calculation by this app, and Mazda does not publish what the values mean.",
                started,
                "/status",
            )
        )
    return out


def new_warning_flag(ctx: Context) -> list[Candidate]:
    """A warning-lamp bit flag (one of 128, almost all always off) set for the first time within the
    lookback window, like a new warning code. The meaning is unknown unless you described it in
    config/models/<id>/codes/warning_flags.yaml (its severity is used then)."""
    rule = ctx.cfg.rules.new_warning_flag
    rows = ctx.con.execute(
        """SELECT flag, area, bit, title, severity, first_on_at, readings_on, readings, first_on_report_day
           FROM v_warning_flags WHERE first_on_at >= ? ORDER BY first_on_at, flag""",
        [ctx.since],
    ).fetchall()
    out = []
    for flag, area, bit, title, sev, first, n_on, n, report_day in rows:
        if flag in rule.ignore_flags:
            continue
        what = title or f"{area} bit {bit}"
        detail = (
            f"The flag {flag} ({area}, bit {bit}) was set for the first time on {_fmt(first)}; "
            f"so far it was on in {n_on} of {n} readings."
        )
        if report_day:
            detail += " That is a day a diagnostic report was taken."
        if not title:
            detail += (
                " Mazda does not publish what it means: Status > Warning lamps shows what happens "
                "around it, and the model's codes/warning_flags.yaml (config/models/<id>/) is where to describe it."
            )
        out.append(
            Candidate(
                "new_warning_flag",
                f"new_warning_flag:{flag}",
                sev if sev in ("info", "warning", "critical") else rule.severity,
                f"New warning-lamp flag set: {what}",
                detail,
                first,
                "/status",
            )
        )
    return out


DETECTORS: dict[str, Callable[[Context], list[Candidate]]] = {
    "new_dtc": new_dtc,
    "recurring_dtc": recurring_dtc,
    "new_warning_code": new_warning_code,
    "warning_spike": warning_spike,
    "burglar_alarm": burglar_alarm,
    "high_consumption": high_consumption,
    "low_fuel": low_fuel,
    "low_tire_pressure": low_tire_pressure,
    "tire_leak_forecast": tire_leak_forecast,
    "low_battery_frame": low_battery_frame,
    "unusual_report": unusual_report,
    "data_gap": data_gap,
    "oil_change_due": oil_change_due,
    "car_warning_flag": car_warning_flag,
    "new_warning_flag": new_warning_flag,
}
