"""Check ``car_timezone`` (config/settings.yaml) against your data, and suggest zones that fit.

The car sends "when were the tire pressures measured" in its own LOCAL time. If the zone is wrong the
measurements land in the future or hours in the past. A right zone gives ages that are never negative
and, for most snapshots, a few minutes (the car measures while driving and reports soon after).

Usage: python -m mazda_dash.timezone_check --db ../db/mazda.duckdb --settings ../config/settings.yaml
(exit status 1 when the configured zone does not fit)"""

import argparse
import statistics
import sys
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo, available_timezones

import duckdb
import yaml

# a car can stand for days (the demo has a 62 hour old one), but not for a month
MAX_AGE_MIN = 30 * 24 * 60
# the car clock and the snapshot clock may disagree by a minute
NEGATIVE_TOLERANCE_MIN = -1.0
# at least one tenth of the readings are taken soon after a drive, so the right zone shows small ages
SOON_MIN = 20.0


def clock_readings(con: duckdb.DuckDBPyConnection) -> list[tuple[datetime, datetime]]:
    """(snapshot time UTC, measurement time as the car's local clock) for every snapshot that has one."""
    rows = con.execute(
        """SELECT created_at,
                  max(value_num) FILTER (WHERE signal = 'tprsdispyear' AND valid IS NOT FALSE),
                  max(value_num) FILTER (WHERE signal = 'tprsdispmonth' AND valid IS NOT FALSE),
                  max(value_num) FILTER (WHERE signal = 'tprsdispdate' AND valid IS NOT FALSE),
                  max(value_num) FILTER (WHERE signal = 'tprsdisphour' AND valid IS NOT FALSE),
                  max(value_num) FILTER (WHERE signal = 'tprsdispminute' AND valid IS NOT FALSE)
           FROM signal_readings WHERE source = 'rts' GROUP BY created_at ORDER BY created_at"""
    ).fetchall()
    out = []
    for created, *parts in rows:
        if None in parts:
            continue
        try:
            out.append((created, datetime(*(int(p) for p in parts))))
        except ValueError:
            continue  # 255, month 13, 30 February ...
    return out


def ages_minutes(readings, zone: str) -> list[float]:
    tz = ZoneInfo(zone)
    return [
        (
            created - local.replace(tzinfo=tz).astimezone(UTC).replace(tzinfo=None)
        ).total_seconds()
        / 60
        for created, local in readings
    ]


def fits(ages: list[float]) -> bool:
    if not ages:
        return False
    ordered = sorted(ages)
    return (
        ordered[0] >= NEGATIVE_TOLERANCE_MIN
        and ordered[-1] <= MAX_AGE_MIN
        and ordered[len(ordered) // 10] <= SOON_MIN
    )


def candidate_zones() -> list[str]:
    """Named zones such as Europe/Lisbon (not Etc/GMT+1, posix/... or the legacy aliases)."""
    return sorted(
        z
        for z in available_timezones()
        if "/" in z and not z.startswith(("Etc/", "posix", "right", "US/", "SystemV"))
    )


def check(db: Path, zone: str) -> dict:
    con = duckdb.connect(str(db), read_only=True)
    try:
        readings = clock_readings(con)
    finally:
        con.close()
    ages = ages_minutes(readings, zone) if readings else []
    return {
        "readings": len(readings),
        "zone": zone,
        "fits": fits(ages),
        "negative": sum(a < NEGATIVE_TOLERANCE_MIN for a in ages),
        "too_old": sum(a > MAX_AGE_MIN for a in ages),
        "median_age": statistics.median(ages) if ages else None,
        "suggestions": [z for z in candidate_zones() if fits(ages_minutes(readings, z))]
        if readings
        else [],
    }


def _utc(offset) -> str:
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    return f"UTC{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"


def suggestion_groups(readings, zones: list[str]) -> list[tuple[str, list[str]]]:
    """Fitting zones grouped by the clock offset they had at the first and last reading, so zones that
    behave the same over your data are listed together. Zones of Europe/ and America/ come first."""
    first, last = (
        readings[0][0].replace(tzinfo=UTC),
        readings[-1][0].replace(tzinfo=UTC),
    )
    groups: dict[str, list[str]] = {}
    for z in zones:
        tz = ZoneInfo(z)
        a, b = first.astimezone(tz).utcoffset(), last.astimezone(tz).utcoffset()
        label = _utc(a) if a == b else f"{_utc(a)} at first, {_utc(b)} at last"
        groups.setdefault(label, []).append(z)
    priority = ("Europe/", "America/", "Asia/", "Australia/", "Pacific/", "Africa/")
    rank = lambda z: (
        next((i for i, p in enumerate(priority) if z.startswith(p)), 9),
        z,
    )
    return [(label, sorted(zs, key=rank)) for label, zs in sorted(groups.items())]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=Path("../db/mazda.duckdb"))
    ap.add_argument("--settings", type=Path, default=Path("../config/settings.yaml"))
    args = ap.parse_args()
    settings = (
        yaml.safe_load(args.settings.read_text()) if args.settings.exists() else {}
    )
    zone = str((settings or {}).get("car_timezone", "UTC"))
    r = check(args.db, zone)
    if not r["readings"]:
        print("No tire measurement times in the database yet (run `make ingest`).")
        sys.exit(1)
    if r["fits"]:
        print(
            f"car_timezone {zone}: fits. {r['readings']} measurement times, none in the future, "
            f"median {r['median_age']:.0f} min before the snapshot."
        )
    else:
        print(
            f"car_timezone {zone}: DOES NOT FIT. Of {r['readings']} measurement times, {r['negative']} are "
            f"in the future and {r['too_old']} are over {MAX_AGE_MIN // 1440} days old."
        )
    if r["suggestions"]:
        con = duckdb.connect(str(args.db), read_only=True)
        readings = clock_readings(con)
        con.close()
        print(
            "Clocks that fit your data (choose the zone for where you live; one that observes daylight"
        )
        print("saving time matters if your data runs through a clock change):")
        for label, zones in suggestion_groups(readings, r["suggestions"]):
            shown = ", ".join(zones[:5]) + (
                f" and {len(zones) - 5} more" if len(zones) > 5 else ""
            )
            print(f"  {label}: {shown}")
    elif not r["fits"]:
        print(
            "No named zone fits. The measurement times may not be in local time; see docs/data-dictionary.md."
        )
    sys.exit(0 if r["fits"] else 1)


if __name__ == "__main__":
    main()
