"""Export the database as a *data pack* for the offline mobile app.

A pack (``*.cx5pack``) is a zip file holding one Parquet file per table plus ``manifest.json``.
It is Parquet and not the ``.duckdb`` file because the browser's DuckDB is a different,
independently versioned build; the ``.duckdb`` storage format is not guaranteed to open across
versions, Parquet is. The app rebuilds the SQL views from ``model/views.sql``.

A phone should hold as little as it needs, and a small pack loads faster: GPS positions
(``latitude`` / ``longitude``) are always left out, and by default so is every signal that no view
reads. ``signal_readings`` holds 200 signals but ``views.sql`` uses 24, which is about a tenth of
its rows. The round-trip test proves the views are identical either way.

With ``--reference`` a second file ``<pack>.reference.json`` is written for tests: per view, a SQL
*fingerprint* query (row count plus per-column counts and sums or min/max) and the value it must
return. A browser that rebuilds the views from the pack must reproduce every fingerprint.

Usage: python -m mazda_dash.pack --db ../db/mazda.duckdb --out ../db/mazda.cx5pack [--reference]
"""

import argparse
import hashlib
import json
import re
import tempfile
import zipfile
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path

import duckdb

PACK_FORMAT = 1
TABLES = [
    "warning_events",
    "warning_codes",
    "dtc_headers",
    "dtc_readings",
    "dtc_snapshots",
    "dtc_snapshot_values",
    "signal_readings",
    "diag_reports",
    "diag_values",
    "diag_dtcs",
    "diag_snapshots",
    "diag_obd_tests",
    "alerts",
    "ref_warning_codes",
    "ref_dtc_codes",
    "ref_ecus",
    "ref_failure_types",
]
# GPS positions never leave the Mac, whatever else is exported.
GPS_SIGNALS = ("latitude", "longitude")
# Created empty when the database has no such table yet (alerts are only created on first evaluation).
EMPTY_ALERTS = (
    "SELECT NULL::BIGINT AS alert_id, NULL::VARCHAR AS dedup_key, NULL::VARCHAR AS rule, "
    "NULL::VARCHAR AS severity, NULL::VARCHAR AS title, NULL::VARCHAR AS detail, "
    "NULL::VARCHAR AS link, NULL::TIMESTAMP AS occurred_at, NULL::TIMESTAMP AS created_at, "
    "NULL::VARCHAR AS status, NULL::TIMESTAMP AS acknowledged_at WHERE false"
)

NUMERIC = ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT",
           "UINTEGER", "UBIGINT", "FLOAT", "DOUBLE", "DECIMAL")  # fmt: skip


def views_sql() -> str:
    return resources.files("mazda_dash.model").joinpath("views.sql").read_text()


def used_signals(sql: str | None = None) -> list[str]:
    """The ``signal_readings`` signals that any view reads (every use is ``signal = '<name>'``)."""
    return sorted(set(re.findall(r"signal = '([a-z0-9_]+)'", sql or views_sql())))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fingerprint_sql(con: duckdb.DuckDBPyConnection, view: str) -> str:
    """One query describing a view's contents in a way that is the same in any DuckDB version."""
    parts = ["count(*) AS n"]
    for name, dtype, *_ in con.execute(f'DESCRIBE "{view}"').fetchall():
        col = f'"{name}"'
        parts.append(f'count({col}) AS "{name}__n"')
        if dtype == "BOOLEAN":
            parts.append(f'count(*) FILTER (WHERE {col}) AS "{name}__true"')
        elif dtype.startswith(NUMERIC):
            parts.append(f'round(sum({col})::DOUBLE, 3) AS "{name}__sum"')
        else:
            parts.append(f'count(DISTINCT {col}) AS "{name}__distinct"')
            parts.append(f'min({col}::VARCHAR) AS "{name}__min"')
            parts.append(f'max({col}::VARCHAR) AS "{name}__max"')
    return f'SELECT {", ".join(parts)} FROM "{view}"'


def _plain(value):
    """JSON-friendly value (decimals and big integers become numbers)."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int):
        return value
    return float(value)


def reference(con: duckdb.DuckDBPyConnection, signals: list[str] | None = None) -> dict:
    views = [
        r[0]
        for r in con.execute(
            "SELECT view_name FROM duckdb_views() WHERE NOT internal AND view_name LIKE 'v\\_%' ESCAPE '\\' "
            "ORDER BY view_name"
        ).fetchall()
    ]
    out = {}
    for view in views:
        sql = fingerprint_sql(con, view)
        cur = con.execute(sql)
        names = [d[0] for d in cur.description]
        out[view] = {
            "sql": sql,
            "expected": dict(zip(names, map(_plain, cur.fetchone()), strict=True)),
        }
    return {
        "format": PACK_FORMAT,
        "engine": con.execute("SELECT version()").fetchone()[0],
        "views": out,
        "tables": {
            t: con.execute(
                f"SELECT count(*) FROM {_select(con, t, signals)}"
            ).fetchone()[0]
            for t in TABLES
        },
    }


def _has_table(con: duckdb.DuckDBPyConnection, name: str) -> bool:
    return bool(
        con.execute(
            "SELECT 1 FROM duckdb_tables() WHERE table_name = ?", [name]
        ).fetchone()
    )


def _select(
    con: duckdb.DuckDBPyConnection, table: str, signals: list[str] | None = None
) -> str:
    """What to export for a table, as a parenthesised subquery.

    ``signals``: keep only these ``signal_readings`` signals (None = all except GPS)."""
    if table == "alerts" and not _has_table(con, "alerts"):
        return f"({EMPTY_ALERTS})"
    where = ""
    if table == "signal_readings":
        if signals is None:
            where = " WHERE signal NOT IN ({})".format(
                ", ".join(f"'{g}'" for g in GPS_SIGNALS)
            )
        else:
            kept = [g for g in signals if g not in GPS_SIGNALS]
            where = " WHERE signal IN ({})".format(", ".join(f"'{g}'" for g in kept))
    return f'(SELECT * FROM "{table}"{where})'


def build_pack(
    db: Path,
    out: Path,
    *,
    with_reference: bool = False,
    compression: str = "zstd",
    all_signals: bool = False,
) -> dict:
    """Write the pack (and optionally its reference file); returns the manifest.

    By default ``signal_readings`` keeps only the signals the views read; ``all_signals`` keeps
    every signal except GPS."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        missing = [t for t in TABLES if t not in ("alerts",) and not _has_table(con, t)]
        if missing:
            raise SystemExit(
                f"{db} is missing {', '.join(missing)}; run `make ingest` (which also builds the views) first."
            )
        span = con.execute(
            "SELECT CAST(min(read_at) AS DATE)::VARCHAR, CAST(max(read_at) AS DATE)::VARCHAR "
            "FROM v_odometer_readings"
        ).fetchone()
        sql = views_sql()
        signals = None if all_signals else used_signals(sql)
        tables: dict[str, dict] = {}
        with tempfile.TemporaryDirectory() as tmp:
            files = {}
            for table in TABLES:
                path = Path(tmp) / f"{table}.parquet"
                con.execute(
                    f"COPY {_select(con, table, signals)} TO '{path}' (FORMAT PARQUET, COMPRESSION {compression})"
                )
                data = path.read_bytes()
                files[f"tables/{table}.parquet"] = data
                rows = con.execute(
                    f"SELECT count(*) FROM read_parquet('{path}')"
                ).fetchone()[0]
                tables[table] = {
                    "rows": rows,
                    "bytes": len(data),
                    "sha256": _sha256(data),
                }
            manifest = {
                "format": PACK_FORMAT,
                "kind": "cx5pack",
                "created_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "generator": "mazda-dash",
                "duckdb": duckdb.__version__,
                "compression": compression,
                "views_sql_sha256": _sha256(sql.encode()),
                "first_data_day": span[0],
                "last_data_day": span[1],
                "excluded": "GPS positions (latitude, longitude)",
                "signals": "all" if signals is None else signals,
                "tables": tables,
            }
            out.parent.mkdir(parents=True, exist_ok=True)
            # stored, not deflated: Parquet is already compressed
            with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
                z.writestr("manifest.json", json.dumps(manifest, indent=1))
                for name, data in files.items():
                    z.writestr(name, data)
        if with_reference:
            ref = reference(con, signals)
            ref["views_sql_sha256"] = manifest["views_sql_sha256"]
            Path(f"{out}.reference.json").write_text(json.dumps(ref, indent=1))
        return manifest
    finally:
        con.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=Path("../db/mazda.duckdb"))
    ap.add_argument("--out", type=Path, default=Path("../db/mazda.cx5pack"))
    ap.add_argument(
        "--reference",
        action="store_true",
        help="also write <out>.reference.json (tests)",
    )
    ap.add_argument(
        "--compression",
        default="zstd",
        choices=["zstd", "snappy", "gzip", "uncompressed"],
    )
    ap.add_argument(
        "--all-signals",
        action="store_true",
        help="keep signals no view reads (bigger, slower to load)",
    )
    args = ap.parse_args()
    manifest = build_pack(
        args.db,
        args.out,
        with_reference=args.reference,
        compression=args.compression,
        all_signals=args.all_signals,
    )
    size = args.out.stat().st_size
    rows = sum(t["rows"] for t in manifest["tables"].values())
    print(
        f"{args.out}: {size / 1024:.0f} KiB, {len(manifest['tables'])} tables, {rows:,} rows, "
        f"data {manifest['first_data_day']} to {manifest['last_data_day']}"
    )
    if args.reference:
        print(f"{args.out}.reference.json written")


if __name__ == "__main__":
    main()
