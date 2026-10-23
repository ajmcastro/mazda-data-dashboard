"""Alerts engine: rules in config/alerts.yaml -> alerts table. Use ``python -m mazda_dash.alerts``."""

import argparse
from pathlib import Path

import duckdb

from .config import load_config
from .engine import run_alerts
from .notify import notify_desktop
from .store import Candidate


def evaluate(
    db: Path, config: Path | None, notify: bool = False
) -> tuple[list[Candidate], int]:
    """Run the rules against ``db``; returns (alerts created now, unacknowledged total)."""
    cfg = load_config(config)
    con = duckdb.connect(str(db))
    try:
        created = run_alerts(con, cfg)
        open_count = con.execute(
            "SELECT count(*) FROM alerts WHERE status = 'new'"
        ).fetchone()[0]
    finally:
        con.close()
    if created and (notify or cfg.notifications.desktop):
        notify_desktop(created, cfg)
    return created, open_count


def report(created: list[Candidate], open_count: int) -> None:
    for a in created:
        print(f"[{a.severity:8}] {a.title}")
    print(f"{len(created)} new alert(s); {open_count} unacknowledged in total")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=Path("../db/mazda.duckdb"))
    ap.add_argument("--config", type=Path, default=Path("../config/alerts.yaml"))
    ap.add_argument(
        "--notify", action="store_true", help="send a desktop notification (macOS)"
    )
    args = ap.parse_args()
    report(*evaluate(args.db, args.config, args.notify))
