from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path

import duckdb
from fastapi import Depends, HTTPException

from ..models import Model
from .selection import database_of, get_model, registry

Selected = Depends(get_model)


def db_path(model: Model | None = None) -> Path:
    """The database of ``model`` (default: the default model); see ``selection.database_of``."""
    return database_of(model or registry().default)


def get_con(
    model: Model = Selected,
) -> Iterator[duckdb.DuckDBPyConnection]:
    """One short-lived read-only connection per request, so `make ingest` can write between calls."""
    path = db_path(model)
    if not path.exists():
        raise HTTPException(
            503,
            f"Database {path} not found - run `make ingest MODEL={model.id}` first",
        )
    con = duckdb.connect(str(path), read_only=True)
    try:
        yield con
    finally:
        con.close()


def get_rw_con(
    model: Model = Selected,
) -> Iterator[duckdb.DuckDBPyConnection]:
    """Read-write connection for the few endpoints that change state (acknowledging alerts)."""
    path = db_path(model)
    if not path.exists():
        raise HTTPException(
            503,
            f"Database {path} not found - run `make ingest MODEL={model.id}` first",
        )
    try:
        con = duckdb.connect(str(path))
    except (
        duckdb.IOException
    ) as e:  # another process (e.g. `make ingest`) holds the write lock
        raise HTTPException(
            503, "Database is busy (is `make ingest` running?) - try again"
        ) from e
    try:
        yield con
    finally:
        con.close()


def has_table(con: duckdb.DuckDBPyConnection, name: str) -> bool:
    return bool(
        con.execute(
            "SELECT 1 FROM duckdb_tables() WHERE table_name = ?", [name]
        ).fetchone()
    )


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
