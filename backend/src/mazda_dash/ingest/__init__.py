"""Ingest the raw Mazda exports into a DuckDB database. Safe to re-run."""

import argparse
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from ..alerts import evaluate, report
from ..audit import mask
from ..model import build_model
from ..models import add_model_option, resolve
from .csv_loaders import LOADERS, ORDER
from .diag_parser import parse_diag_file
from .schema import init_schema


def load_diag(con: duckdb.DuckDBPyConnection, path: Path) -> tuple[int, int]:
    report = parse_diag_file(path)
    rows_read = (
        len(report.values)
        + len(report.dtcs)
        + len(report.snapshots)
        + len(report.obd_tests)
    )
    if con.execute(
        "SELECT 1 FROM diag_reports WHERE report_id = ?", [report.report_id]
    ).fetchone():
        return rows_read, 0
    rid = report.report_id
    con.execute(
        "INSERT INTO diag_reports VALUES (?, ?, ?, ?, ?)",
        [rid, report.source_file, report.vin, report.taken_at, report.odometer_km],
    )
    for table, rows in (
        ("diag_values", report.values),
        ("diag_dtcs", report.dtcs),
        ("diag_snapshots", report.snapshots),
        ("diag_obd_tests", report.obd_tests),
    ):
        if rows:
            marks = ", ".join("?" * (len(rows[0]) + 1))
            con.executemany(
                f"INSERT INTO {table} VALUES ({marks})", [[rid, *r] for r in rows]
            )
    return rows_read, rows_read


def find_files(data_dir: Path) -> list[tuple[str, Path]]:
    """Map each CSV to its kind via the ``_<kind>-`` part of the file name."""
    found = []
    for kind in ORDER:
        found += [(kind, p) for p in sorted(data_dir.glob(f"*_{kind}-*.csv"))]
    found += [("diag", p) for p in sorted(data_dir.glob("*diag-tool*.txt"))]
    return found


VIN_TABLES = ("warning_events", "dtc_headers", "signal_readings", "diag_reports")


def distinct_vins(db_path: Path) -> list[str]:
    """Every VIN stored in the database. A model's database is meant to hold one car."""
    con = duckdb.connect(str(db_path), read_only=True)
    try:
        sql = " UNION ".join(
            f"SELECT vin FROM {t} WHERE vin IS NOT NULL AND vin <> ''"
            for t in VIN_TABLES
        )
        return sorted(r[0] for r in con.execute(sql).fetchall())
    finally:
        con.close()


def ingest(
    data_dir: Path,
    db_path: Path,
    config_dir: Path | None = None,
    settings_path: Path | None = None,
) -> list[tuple[str, str, int, int]]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    init_schema(con)
    results = []
    now = datetime.now(UTC).replace(tzinfo=None)
    for kind, path in find_files(data_dir):
        loader = load_diag if kind == "diag" else LOADERS[kind]
        rows_read, rows_new = loader(con, path)
        con.execute(
            "INSERT INTO ingest_runs VALUES (?, ?, ?, ?, ?)",
            [now, path.name, kind, rows_read, rows_new],
        )
        results.append((kind, path.name, rows_read, rows_new))
    if config_dir is not None:
        build_model(con, config_dir, settings_path)
    con.close()
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    add_model_option(ap)
    ap.add_argument(
        "--data", type=Path, help="raw exports (default: the model's data folder)"
    )
    ap.add_argument("--db", type=Path, help="database (default: the model's)")
    ap.add_argument(
        "--config", type=Path, help="code descriptions (default: the model's)"
    )
    ap.add_argument(
        "--settings",
        type=Path,
        help="settings file (default: the model's; the demo uses its own)",
    )
    ap.add_argument(
        "--alerts-config", type=Path, help="alert rules (default: the model's)"
    )
    ap.add_argument(
        "--no-alerts", action="store_true", help="skip evaluating alert rules"
    )
    ap.add_argument(
        "--notify", action="store_true", help="desktop notification for new alerts"
    )
    args = ap.parse_args()
    model = resolve(args.model, args.root)
    if model.legacy:
        print(
            f"note: {model.id} is still in the single-car layout ({', '.join(model.legacy)}); "
            "`make migrate-models` moves it"
        )
    data, db = args.data or model.data_dir, args.db or model.db_path
    codes = args.config or model.codes_dir
    alerts = args.alerts_config or model.alerts_path
    if not find_files(data):
        print(f"warning: no export files for {model.name} in {data}")
        if not db.exists():
            print("nothing to load (no database is created for an empty folder)")
            return
    for note, path in (("code descriptions", codes), ("alert rules", alerts)):
        if not path.exists():
            print(f"note: {path} not found, {note} use the built-in defaults")
    for kind, name, read, new in ingest(
        data, db, codes, args.settings or model.settings_path
    ):
        print(f"{kind:8} read={read:6} new={new:6}  {name}")
    print("database:", db)
    vins = distinct_vins(db)
    if len(vins) > 1:
        print(
            f"warning: {model.name} holds {len(vins)} different VINs ({', '.join(mask(v) for v in vins)}); "
            "a model folder is meant to hold one car, so its figures mix cars"
        )
    if not args.no_alerts:
        report(*evaluate(db, alerts, args.notify, model.name))
