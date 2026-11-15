"""Settings (``config/models/<id>/settings.yaml``) as a ``ref_settings`` table and a ``ref_fuel_prices`` table, so
the SQL views and the phone app's copy of them read the same values. The optional ``fuel_log.yaml`` next to
it (what the owner paid for fuel) becomes ``ref_fuel_paid``."""

import itertools
import json
import math
import re
from datetime import date
from pathlib import Path

import duckdb
import yaml

DEFAULTS = {"car_timezone": "UTC", "tire_stale_hours": "6"}
# fuel_currency / fuel_prices / fuel_price_per_l are optional: without a price there is no cost figure
FUEL_KEYS = {"fuel_currency", "fuel_prices", "fuel_price_per_l"}
# the fill-ups (M47): the tank's size turns points of fuel level into litres (no default: without it the log
# shows points), and a rise of the level counts as a fill-up from this many points on
REFUEL_KEYS = {"tank_litres", "refuel_min_points"}
REFUEL_MIN_POINTS = 15.0
# the yearly distance (M52): `mileage: {limit_km_per_year: 15000, start_date: 2026-03-03}` (a lease or
# warranty year); optional, without it only the yearly pace is shown
MILEAGE_KEY = "mileage"
CURRENCY = re.compile(r"[A-Z]{3}")
SINGLE_PRICE_FROM = date(1970, 1, 1)  # a lone fuel_price_per_l applies to all the data


def _price(path: Path | None, value: object, where: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(  # noqa: TRY004 - every settings error is a ValueError that names the file
            f"{path}: {where} must be a number (the price of a litre)"
        )
    price = float(value)
    if not math.isfinite(price) or price <= 0:
        raise ValueError(f"{path}: {where} must be a number above 0")
    return price


def fuel_prices(path: Path | None, data: dict) -> list[tuple[date, float]]:
    """The price history from the file, checked: ``fuel_prices`` (price per litre from a date on, dates in
    order) or one ``fuel_price_per_l``. Empty when no price is set."""
    if "fuel_prices" in data and "fuel_price_per_l" in data:
        raise ValueError(
            f"{path}: use either fuel_prices or fuel_price_per_l, not both"
        )
    if "fuel_price_per_l" in data:
        entries = [
            (
                SINGLE_PRICE_FROM,
                _price(path, data["fuel_price_per_l"], "fuel_price_per_l"),
            )
        ]
    elif "fuel_prices" in data:
        raw = data["fuel_prices"]
        if not isinstance(raw, list) or not raw:
            raise ValueError(
                f"{path}: fuel_prices must be a list of {{from: date, per_l: price}}"
            )
        entries = []
        for i, item in enumerate(raw, 1):
            where = f"fuel_prices entry {i}"
            if not isinstance(item, dict) or set(item) != {"from", "per_l"}:
                raise ValueError(
                    f"{path}: {where} must have exactly `from` and `per_l`"
                )
            start = item["from"]
            try:
                start = (
                    start if isinstance(start, date) else date.fromisoformat(str(start))
                )
            except ValueError as e:
                raise ValueError(
                    f"{path}: {where}: `from` must be a date such as 2026-05-15"
                ) from e
            entries.append((start, _price(path, item["per_l"], f"{where}: per_l")))
        if any(b[0] <= a[0] for a, b in itertools.pairwise(entries)):
            raise ValueError(
                f"{path}: fuel_prices dates must be in increasing order, one entry per date"
            )
    else:
        entries = []
    if entries:
        currency = data.get("fuel_currency")
        if not isinstance(currency, str) or not CURRENCY.fullmatch(currency):
            raise ValueError(
                f"{path}: fuel_currency (an ISO code such as EUR) is required with a fuel price"
            )
    elif "fuel_currency" in data:
        raise ValueError(
            f"{path}: fuel_currency without a fuel price; set fuel_prices or fuel_price_per_l"
        )
    return entries


def _number(path: Path | None, data: dict, key: str, lo: float, hi: float, what: str):
    """An optional number in a range; None when the file does not set it."""
    if key not in data:
        return None
    value = data[key]
    if (
        isinstance(value, bool)
        or not isinstance(value, int | float)
        or not lo <= value <= hi
    ):
        raise ValueError(
            f"{path}: {key} must be a number from {lo:g} to {hi:g} ({what})"
        )
    return float(value)


def fuel_paid(path: Path) -> list[tuple[date, float, float | None]]:
    """What the owner paid for fuel, from ``fuel_log.yaml``: a list of ``{date, paid, litres?}``, checked.
    Empty when there is no file. The amounts are in the settings' ``fuel_currency``."""
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text())
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError(  # noqa: TRY004 - every settings error is a ValueError that names the file
            f"{path}: expected a list of {{date: 2026-05-15, paid: 62.40, litres: 34.1}} (litres optional)"
        )
    entries = []
    for i, item in enumerate(raw, 1):
        where = f"entry {i}"
        if (
            not isinstance(item, dict)
            or not {"date", "paid"} <= set(item)
            or set(item) - {"date", "paid", "litres"}
        ):
            raise ValueError(
                f"{path}: {where} must have `date` and `paid`, and may have `litres`"
            )
        day = item["date"]
        try:
            day = day if isinstance(day, date) else date.fromisoformat(str(day))
        except ValueError as e:
            raise ValueError(
                f"{path}: {where}: `date` must be a date such as 2026-05-15"
            ) from e
        paid = _price(path, item["paid"], f"{where}: paid")
        litres = (
            _price(path, item["litres"], f"{where}: litres")
            if item.get("litres") is not None
            else None
        )
        entries.append((day, paid, litres))
    return entries


SERVICE_KINDS = ("oil_change", "tires", "service", "software", "repair", "other")
SERVICE_HEADER = (
    "# What was done to the car (the dashboard's service log). One line per entry:\n"
    '#   - {date: 2026-09-14, kind: oil_change, note: "Oil and filter at the dealer", odometer_km: 4310}\n'
    f"# kind is one of: {', '.join(SERVICE_KINDS)}. odometer_km is optional. Then run `make model`.\n"
)


def service_entry(
    where: str, day, kind, note, odometer
) -> tuple[date, str, str, float | None]:
    """One checked entry of the service log; ``where`` names the file and the entry in an error."""
    try:
        day = day if isinstance(day, date) else date.fromisoformat(str(day))
    except ValueError as e:
        raise ValueError(f"{where}: `date` must be a date such as 2026-09-14") from e
    if kind not in SERVICE_KINDS:
        raise ValueError(
            f"{where}: `kind` must be one of {', '.join(SERVICE_KINDS)}, not {kind!r}"
        )
    if not isinstance(note, str) or not note.strip() or "\n" in note or len(note) > 200:
        raise ValueError(
            f"{where}: `note` must be one line of text, up to 200 characters"
        )
    if odometer is not None:
        if (
            isinstance(odometer, bool)
            or not isinstance(odometer, int | float)
            or not 0 <= odometer <= 2_000_000
        ):
            raise ValueError(f"{where}: `odometer_km` must be a number of kilometres")
        odometer = float(odometer)
    return day, kind, note.strip(), odometer


def service_entries(path: Path) -> list[tuple[date, str, str, float | None]]:
    """What was done to the car, from ``service_log.yaml``: a list of ``{date, kind, note, odometer_km?}``,
    checked (a typo in ``kind`` fails loudly). Empty when there is no file."""
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text())
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError(  # noqa: TRY004 - every settings error is a ValueError that names the file
            f"{path}: expected a list of {{date: 2026-09-14, kind: oil_change, note: ...}}"
        )
    entries = []
    for i, item in enumerate(raw, 1):
        where = f"{path}: entry {i}"
        if (
            not isinstance(item, dict)
            or not {"date", "kind", "note"} <= set(item)
            or set(item) - {"date", "kind", "note", "odometer_km"}
        ):
            raise ValueError(
                f"{where} must have `date`, `kind` and `note`, and may have `odometer_km`"
            )
        entries.append(
            service_entry(
                where, item["date"], item["kind"], item["note"], item.get("odometer_km")
            )
        )
    return entries


def load_service_log(con: duckdb.DuckDBPyConnection, path: Path | None) -> int:
    """(Re)create ``ref_service_log`` from the file (always a table, empty without the file); `n` keeps the
    file's order. Returns the number of entries."""
    entries = service_entries(path) if path is not None else []
    con.execute(
        "CREATE OR REPLACE TABLE ref_service_log "
        "(n INTEGER, served_on DATE, kind VARCHAR, note VARCHAR, odometer_km DOUBLE)"
    )
    if entries:
        con.executemany(
            "INSERT INTO ref_service_log VALUES (?, ?, ?, ?, ?)",
            [(i, *e) for i, e in enumerate(entries, 1)],
        )
    return len(entries)


def service_line(day: date, kind: str, note: str, odometer: float | None) -> str:
    """One entry as the line the file holds (the note quoted the JSON way, which YAML reads)."""
    text = f"- {{date: {day.isoformat()}, kind: {kind}, note: {json.dumps(note, ensure_ascii=False)}"
    if odometer is not None:
        text += f", odometer_km: {odometer:g}"
    return text + "}"


def add_service_entry(path: Path, day, kind, note, odometer) -> bool:
    """Append one entry to ``service_log.yaml``, keeping everything that is there (comments included). An
    entry the file already has is not added again (False). The file is checked before and after."""
    entry = service_entry(str(path), day, kind, note, odometer)
    if entry in service_entries(path):
        return False
    before = path.read_text() if path.exists() else SERVICE_HEADER
    if before and not before.endswith("\n"):
        before += "\n"
    path.write_text(before + service_line(*entry) + "\n")
    service_entries(path)  # what was written must read back
    return True


def _mileage(path: Path | None, raw: object) -> dict[str, str]:
    """The yearly distance limit and the day its year starts, checked; nothing without the setting."""
    if raw is None:
        return {}
    example = "mileage: {limit_km_per_year: 15000, start_date: 2026-03-03}"
    if not isinstance(raw, dict) or set(raw) != {"limit_km_per_year", "start_date"}:
        raise ValueError(
            f"{path}: mileage must have `limit_km_per_year` and `start_date`, e.g. {example}"
        )
    limit, start = raw["limit_km_per_year"], raw["start_date"]
    if (
        isinstance(limit, bool)
        or not isinstance(limit, int | float)
        or not 1000 <= limit <= 200_000
    ):
        raise ValueError(
            f"{path}: mileage.limit_km_per_year must be a number of kilometres (1,000 to 200,000)"
        )
    try:
        start = start if isinstance(start, date) else date.fromisoformat(str(start))
    except ValueError as e:
        raise ValueError(
            f"{path}: mileage.start_date must be a date such as 2026-03-03"
        ) from e
    if start.month == 2 and start.day == 29:
        raise ValueError(
            f"{path}: mileage.start_date cannot be 29 February (use 28 February or 1 March)"
        )
    return {"mileage_limit_km": f"{limit:g}", "mileage_start": start.isoformat()}


def load_settings(con: duckdb.DuckDBPyConnection, path: Path | None) -> dict[str, str]:
    """Create ``ref_settings`` and ``ref_fuel_prices`` from the file (defaults for what is missing) and
    return the settings."""
    data = {}
    if path is not None and path.exists():
        data = yaml.safe_load(path.read_text()) or {}
        if not isinstance(data, dict):
            raise TypeError(f"{path}: expected a mapping of setting -> value")
    known = {*DEFAULTS, *FUEL_KEYS, *REFUEL_KEYS, MILEAGE_KEY}
    unknown = set(data) - known
    if unknown:
        raise ValueError(
            f"{path}: unknown setting(s) {sorted(unknown)}; known: {sorted(known)}"
        )
    prices = fuel_prices(path, data)
    values = {
        **DEFAULTS,
        **{k: str(v) for k, v in data.items() if k in DEFAULTS},
    }
    try:
        # the same ICU database the views use decides what a valid zone is
        con.execute(
            "SELECT timezone(?, TIMESTAMP '2026-01-01 00:00:00')",
            [values["car_timezone"]],
        )
    except duckdb.Error as e:
        raise ValueError(
            f"{path}: car_timezone {values['car_timezone']!r} is not a time zone name "
            "(use an IANA name such as Europe/Lisbon)"
        ) from e
    try:
        hours = float(values["tire_stale_hours"])
    except ValueError:
        hours = 0
    if hours <= 0:
        raise ValueError(f"{path}: tire_stale_hours must be a number above 0")
    values["tire_stale_hours"] = f"{hours:g}"
    # the tire pressure limit of the model's alert rules (alerts.yaml next to the settings; 200 without one),
    # kept here so the views' readers and the phone's pack have it: the leak forecast (M51) aims at it
    from ..alerts.config import load_config

    try:
        alerts = load_config(
            path.with_name("alerts.yaml") if path is not None else None
        )
    except (
        ValueError
    ):  # a broken alerts file is reported by `make alerts`, not by loading the settings
        alerts = load_config(None)
    values["tire_limit_kpa"] = f"{alerts.rules.low_tire_pressure.min_kpa:g}"
    if prices:
        values["fuel_currency"] = data["fuel_currency"]
    values |= _mileage(path, data.get(MILEAGE_KEY))
    tank = _number(path, data, "tank_litres", 20, 200, "the size of the fuel tank")
    if tank is not None:
        values["tank_litres"] = f"{tank:g}"
    points = _number(
        path,
        data,
        "refuel_min_points",
        5,
        80,
        "how many points the fuel level must rise to count as a fill-up",
    )
    values["refuel_min_points"] = (
        f"{points if points is not None else REFUEL_MIN_POINTS:g}"
    )
    con.execute("CREATE OR REPLACE TABLE ref_settings (key VARCHAR, value VARCHAR)")
    con.executemany("INSERT INTO ref_settings VALUES (?, ?)", list(values.items()))
    con.execute(
        "CREATE OR REPLACE TABLE ref_fuel_prices (valid_from DATE, per_l DOUBLE)"
    )
    if prices:
        con.executemany("INSERT INTO ref_fuel_prices VALUES (?, ?)", prices)
    # what the owner paid, from fuel_log.yaml next to the settings (always a table, empty without the file)
    con.execute(
        "CREATE OR REPLACE TABLE ref_fuel_paid (paid_on DATE, paid DOUBLE, litres DOUBLE)"
    )
    paid = fuel_paid(path.with_name("fuel_log.yaml")) if path is not None else []
    if paid and not prices:
        raise ValueError(
            f"{path.with_name('fuel_log.yaml')}: amounts paid need a currency: set fuel_currency and a fuel "
            f"price in {path.name}"
        )
    if paid:
        con.executemany("INSERT INTO ref_fuel_paid VALUES (?, ?, ?)", paid)
    # what was done to the car, from service_log.yaml next to the settings (M50)
    load_service_log(
        con, path.with_name("service_log.yaml") if path is not None else None
    )
    return values
