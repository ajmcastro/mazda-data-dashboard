"""Settings (``config/models/<id>/settings.yaml``) as a ``ref_settings`` table and a ``ref_fuel_prices`` table, so
the SQL views and the phone app's copy of them read the same values."""

import itertools
import math
import re
from datetime import date
from pathlib import Path

import duckdb
import yaml

DEFAULTS = {"car_timezone": "UTC", "tire_stale_hours": "6"}
# fuel_currency / fuel_prices / fuel_price_per_l are optional: without a price there is no cost figure
FUEL_KEYS = {"fuel_currency", "fuel_prices", "fuel_price_per_l"}
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


def load_settings(con: duckdb.DuckDBPyConnection, path: Path | None) -> dict[str, str]:
    """Create ``ref_settings`` and ``ref_fuel_prices`` from the file (defaults for what is missing) and
    return the settings."""
    data = {}
    if path is not None and path.exists():
        data = yaml.safe_load(path.read_text()) or {}
        if not isinstance(data, dict):
            raise TypeError(f"{path}: expected a mapping of setting -> value")
    known = {*DEFAULTS, *FUEL_KEYS}
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
    if prices:
        values["fuel_currency"] = data["fuel_currency"]
    con.execute("CREATE OR REPLACE TABLE ref_settings (key VARCHAR, value VARCHAR)")
    con.executemany("INSERT INTO ref_settings VALUES (?, ?)", list(values.items()))
    con.execute(
        "CREATE OR REPLACE TABLE ref_fuel_prices (valid_from DATE, per_l DOUBLE)"
    )
    if prices:
        con.executemany("INSERT INTO ref_fuel_prices VALUES (?, ?)", prices)
    return values
