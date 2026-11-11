"""Does a model's data have what the dashboard reads? Use it when bringing up a new model.

The views (``model/views.sql``) read named signals of the car's remote status (``signal = '<name>'``) and
families of them (``starts_with(signal, '<prefix>')``). A model whose exports lack a signal does not break
anything: the views simply have nothing for it. This tool lists what is missing (and which views are
affected), what the model has that nothing reads yet, and which kinds of export were loaded.

Usage: python -m mazda_dash.compat [--model cx60] [--all] [--strict]"""

import argparse
import re
import sys
from pathlib import Path

import duckdb

from .ingest.csv_loaders import ORDER
from .models import add_model_option, resolve
from .pack import used_signal_prefixes, used_signals, varying_in_families, views_sql

KINDS = [*ORDER, "diag"]
_VIEW = re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)", re.IGNORECASE)


def views_reading(sql: str, needle: str) -> list[str]:
    """The views whose text contains ``needle`` (a signal test as written in views.sql)."""
    marks = list(_VIEW.finditer(sql))
    found = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(sql)
        if needle in sql[m.start() : end]:
            found.append(m.group(1))
    return found


def compat_report(con: duckdb.DuckDBPyConnection, sql: str | None = None) -> dict:
    """What the views want against what ``con`` holds (read-only queries)."""
    sql = sql or views_sql()
    stats = {
        r[0]: (r[1], r[2])
        for r in con.execute(
            "SELECT signal, count(*), count(*) FILTER (WHERE valid) FROM signal_readings "
            "GROUP BY signal"
        ).fetchall()
    }
    wanted = used_signals(sql)
    prefixes = used_signal_prefixes(sql)
    missing, never_valid = [], []
    for s in wanted:
        readings, valid = stats.get(s, (0, 0))
        entry = {"signal": s, "views": views_reading(sql, f"signal = '{s}'")}
        if readings == 0:
            missing.append(entry)
        elif valid == 0:
            never_valid.append({**entry, "readings": readings})
    families = []
    for p in prefixes:
        members = [s for s in stats if s.startswith(p)]
        families.append(
            {
                "prefix": p,
                "signals": len(members),
                "varying": len(varying_in_families(con, [p])) if members else 0,
                "views": views_reading(sql, f"starts_with(signal, '{p}')"),
            }
        )
    covered = set(wanted)
    unread = sorted(
        s
        for s in stats
        if s not in covered and not any(s.startswith(p) for p in prefixes)
    )
    loaded = {
        r[0]
        for r in con.execute(
            "SELECT DISTINCT kind FROM ingest_runs WHERE rows_read > 0"
        ).fetchall()
    }
    return {
        "wanted": len(wanted),
        "present": len(wanted) - len(missing),
        "missing": missing,
        "never_valid": never_valid,
        "families": families,
        "unread": unread,
        "signals_in_data": len(stats),
        "kinds_loaded": [k for k in KINDS if k in loaded],
        "kinds_missing": [k for k in KINDS if k not in loaded],
    }


def format_report(name: str, r: dict, show_unread: bool = False) -> str:
    out = [
        f"{name}: the views read {r['wanted']} signals, {r['present']} are in the data"
    ]
    out.append(f"  export kinds loaded: {', '.join(r['kinds_loaded']) or 'none'}")
    if r["kinds_missing"]:
        out.append(f"  export kinds not loaded: {', '.join(r['kinds_missing'])}")
    for title, rows in (
        ("missing (no readings at all)", r["missing"]),
        ("never valid (every reading is Invalid)", r["never_valid"]),
    ):
        if rows:
            out.append(f"  {title}:")
            out += [
                f"    {e['signal']}  ->  {', '.join(e['views']) or '?'}" for e in rows
            ]
    for f in r["families"]:
        out.append(
            f"  family {f['prefix']}*: {f['signals']} signals, {f['varying']} change"
            + ("" if f["signals"] else "  (missing)")
        )
    n = len(r["unread"])
    out.append(
        f"  {n} of {r['signals_in_data']} signals in the data are read by no view yet"
    )
    if show_unread and n:
        out += [f"    {s}" for s in r["unread"]]
    elif n:
        out.append("  (--all lists them)")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    add_model_option(ap)
    ap.add_argument("--db", type=Path, help="database (default: the model's)")
    ap.add_argument("--all", action="store_true", help="also list the unread signals")
    ap.add_argument(
        "--strict",
        action="store_true",
        help="exit with status 1 when signals are missing",
    )
    args = ap.parse_args()
    model = resolve(args.model, args.root)
    db = args.db or model.db_path
    if not db.exists():
        print(
            f"{model.name}: no database at {db}; run `make ingest MODEL={model.id}` first"
        )
        return 1
    con = duckdb.connect(str(db), read_only=True)
    try:
        r = compat_report(con)
    finally:
        con.close()
    print(format_report(model.name, r, args.all))
    return 1 if args.strict and (r["missing"] or r["never_valid"]) else 0


if __name__ == "__main__":
    sys.exit(main())
