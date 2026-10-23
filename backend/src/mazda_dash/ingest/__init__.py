"""Ingest the raw Mazda exports into a DuckDB database. Safe to re-run."""

import argparse
from datetime import UTC, datetime
from pathlib import Path

import duckdb

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


def ingest(data_dir: Path, db_path: Path) -> list[tuple[str, str, int, int]]:
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
    con.close()
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=Path("../data"))
    ap.add_argument("--db", type=Path, default=Path("../db/mazda.duckdb"))
    args = ap.parse_args()
    for kind, name, read, new in ingest(args.data, args.db):
        print(f"{kind:8} read={read:6} new={new:6}  {name}")
    print("database:", args.db)
