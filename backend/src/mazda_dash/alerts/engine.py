"""Evaluate the enabled rules and persist alerts that have not been raised before."""

from datetime import UTC, datetime

import duckdb

from .config import AlertsConfig
from .detectors import DETECTORS, Context
from .store import Candidate, add_if_new, init_alerts


def run_alerts(
    con: duckdb.DuckDBPyConnection, cfg: AlertsConfig, now: datetime | None = None
) -> list[Candidate]:
    """Returns the alerts created by this run (empty when nothing is new)."""
    init_alerts(con)
    now = now or datetime.now(UTC).replace(tzinfo=None)
    as_of = con.execute("SELECT max(read_at) FROM v_odometer_readings").fetchone()[0]
    if as_of is None:
        return []
    ctx = Context(con, cfg, as_of, now)
    created = []
    for name, detect in DETECTORS.items():
        if not getattr(cfg.rules, name).enabled:
            continue
        for candidate in detect(ctx):
            if add_if_new(con, candidate, now):
                created.append(candidate)
    return created
