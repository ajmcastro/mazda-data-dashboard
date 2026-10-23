"""The ``alerts`` table: one row per raised alert, keyed by ``dedup_key``."""

from dataclasses import dataclass
from datetime import datetime

import duckdb

DDL = [
    "CREATE SEQUENCE IF NOT EXISTS alert_id_seq",
    """
    CREATE TABLE IF NOT EXISTS alerts (
        alert_id BIGINT DEFAULT nextval('alert_id_seq'),
        dedup_key VARCHAR NOT NULL,
        rule VARCHAR,
        severity VARCHAR,
        title VARCHAR,
        detail VARCHAR,
        link VARCHAR,
        occurred_at TIMESTAMP,
        created_at TIMESTAMP,
        status VARCHAR DEFAULT 'new',
        acknowledged_at TIMESTAMP
    )""",
]


@dataclass
class Candidate:
    rule: str
    dedup_key: str
    severity: str
    title: str
    detail: str
    occurred_at: datetime | None
    link: str = "/alerts"


def init_alerts(con: duckdb.DuckDBPyConnection) -> None:
    for stmt in DDL:
        con.execute(stmt)


def add_if_new(con: duckdb.DuckDBPyConnection, c: Candidate, now: datetime) -> bool:
    """Insert unless an alert with this key exists (whatever its status)."""
    n = con.execute(
        "INSERT INTO alerts (dedup_key, rule, severity, title, detail, link, occurred_at, created_at) "
        "SELECT ?, ?, ?, ?, ?, ?, ?, ? "
        "WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE dedup_key = ?)",
        [
            c.dedup_key,
            c.rule,
            c.severity,
            c.title,
            c.detail,
            c.link,
            c.occurred_at,
            now,
            c.dedup_key,
        ],
    ).fetchone()[0]
    return n > 0
