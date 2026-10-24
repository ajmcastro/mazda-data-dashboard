"""Settings (``config/settings.yaml``) as a ``ref_settings`` table, so the SQL views and the phone app's
copy of them read the same values."""

from pathlib import Path

import duckdb
import yaml

DEFAULTS = {"car_timezone": "UTC", "tire_stale_hours": "6"}


def load_settings(con: duckdb.DuckDBPyConnection, path: Path | None) -> dict[str, str]:
    """Create ``ref_settings`` from the file (defaults for what is missing) and return it."""
    data = {}
    if path is not None and path.exists():
        data = yaml.safe_load(path.read_text()) or {}
        if not isinstance(data, dict):
            raise TypeError(f"{path}: expected a mapping of setting -> value")
    unknown = set(data) - set(DEFAULTS)
    if unknown:
        raise ValueError(
            f"{path}: unknown setting(s) {sorted(unknown)}; known: {sorted(DEFAULTS)}"
        )
    values = {**DEFAULTS, **{k: str(v) for k, v in data.items()}}
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
    con.execute("CREATE OR REPLACE TABLE ref_settings (key VARCHAR, value VARCHAR)")
    con.executemany("INSERT INTO ref_settings VALUES (?, ?)", list(values.items()))
    return values
