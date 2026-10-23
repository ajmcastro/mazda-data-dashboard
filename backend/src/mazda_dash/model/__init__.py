"""Domain model: lookup tables plus SQL views over the ingested tables.

Views are recreated on every build, so they always reflect the current data and
the current ``config/codes`` files. Use ``python -m mazda_dash.model``."""

import argparse
from importlib import resources
from pathlib import Path

import duckdb

from .lookups import load_lookups


def build_model(con: duckdb.DuckDBPyConnection, config_dir: Path) -> None:
    load_lookups(con, config_dir)
    con.execute(resources.files(__package__).joinpath("views.sql").read_text())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=Path("../db/mazda.duckdb"))
    ap.add_argument("--config", type=Path, default=Path("../config/codes"))
    args = ap.parse_args()
    con = duckdb.connect(str(args.db))
    build_model(con, args.config)
    views = con.execute(
        "SELECT view_name FROM duckdb_views() WHERE NOT internal AND view_name LIKE 'v\\_%' ESCAPE '\\' "
        "ORDER BY 1"
    ).fetchall()
    print("views:", ", ".join(v[0] for v in views))
    con.close()
