"""Load the editable code descriptions (``config/codes/*.yaml``) into ``ref_*`` tables."""

from pathlib import Path

import duckdb
import yaml

SEVERITIES = {"info", "warning", "critical", "unknown"}

DDL = [
    """CREATE OR REPLACE TABLE ref_warning_codes (
        code VARCHAR, title VARCHAR, severity VARCHAR, category VARCHAR, notes VARCHAR)""",
    """CREATE OR REPLACE TABLE ref_dtc_codes (
        dtc_code VARCHAR, title VARCHAR, severity VARCHAR, category VARCHAR, notes VARCHAR)""",
    """CREATE OR REPLACE TABLE ref_ecus (ecu VARCHAR, title VARCHAR, notes VARCHAR)""",
    """CREATE OR REPLACE TABLE ref_failure_types (failure_type VARCHAR, title VARCHAR)""",
    """CREATE OR REPLACE TABLE ref_warning_flags (
        flag VARCHAR, title VARCHAR, severity VARCHAR, category VARCHAR, notes VARCHAR)""",
]


def _load(path: Path) -> dict:
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    if not isinstance(data, dict):
        raise TypeError(f"{path}: expected a mapping of code -> details")
    return {str(k): v for k, v in data.items()}


def _described(path: Path, with_severity: bool) -> list[tuple]:
    rows = []
    for key, v in _load(path).items():
        v = v or {}
        unknown = set(v) - {"title", "severity", "category", "notes"}
        if unknown:
            raise ValueError(f"{path}: {key}: unknown field(s) {sorted(unknown)}")
        severity = v.get("severity", "unknown")
        if with_severity and severity not in SEVERITIES:
            raise ValueError(
                f"{path}: {key}: severity must be one of {sorted(SEVERITIES)}"
            )
        if with_severity:
            rows.append(
                (key, v.get("title"), severity, v.get("category"), v.get("notes"))
            )
        else:
            rows.append((key, v.get("title"), v.get("notes")))
    return rows


def load_lookups(con: duckdb.DuckDBPyConnection, config_dir: Path) -> None:
    for stmt in DDL:
        con.execute(stmt)
    for table, file, with_sev in (
        ("ref_warning_codes", "warnings.yaml", True),
        ("ref_dtc_codes", "dtcs.yaml", True),
        ("ref_ecus", "ecus.yaml", False),
        ("ref_warning_flags", "warning_flags.yaml", True),
    ):
        rows = _described(config_dir / file, with_sev)
        if rows:
            marks = ", ".join("?" * len(rows[0]))
            con.executemany(f"INSERT INTO {table} VALUES ({marks})", rows)
    ftb = [
        (k, v if isinstance(v, str) else (v or {}).get("title"))
        for k, v in _load(config_dir / "failure_types.yaml").items()
    ]
    if ftb:
        con.executemany("INSERT INTO ref_failure_types VALUES (?, ?)", ftb)
