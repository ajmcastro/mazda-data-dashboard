import os
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path

import duckdb
from fastapi import HTTPException

DEFAULT_DB = "../db/mazda.duckdb"


def db_path() -> Path:
    return Path(os.environ.get("MAZDA_DB", DEFAULT_DB))


def get_con() -> Iterator[duckdb.DuckDBPyConnection]:
    """One short-lived read-only connection per request, so `make ingest` can write between calls."""
    path = db_path()
    if not path.exists():
        raise HTTPException(503, f"Database {path} not found - run `make ingest` first")
    con = duckdb.connect(str(path), read_only=True)
    try:
        yield con
    finally:
        con.close()


def _clean(v):
    if isinstance(v, datetime):
        return v.replace(tzinfo=UTC)  # the database stores naive UTC
    if isinstance(v, date):
        return v
    return v


def rows(
    con: duckdb.DuckDBPyConnection, sql: str, params: list | None = None
) -> list[dict]:
    cur = con.execute(sql, params or [])
    names = [d[0] for d in cur.description]
    return [
        {n: _clean(v) for n, v in zip(names, r, strict=True)} for r in cur.fetchall()
    ]


def one(con: duckdb.DuckDBPyConnection, sql: str, params: list | None = None) -> dict:
    found = rows(con, sql, params)
    return found[0] if found else {}
