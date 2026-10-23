"""Profile the raw Mazda exports and write one markdown report per file.

Usage: python -m mazda_dash.profile <data_dir> <out_dir>
"""

import re
import sys
from pathlib import Path

import duckdb

TS_KEYS = ("_tm", "datetime", "datacreationtime", "time")


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def profile_csv(con: duckdb.DuckDBPyConnection, path: Path) -> str:
    rel = f"read_csv('{path}', all_varchar=true, nullstr='', header=true)"
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {rel}").fetchall()]
    n = con.execute(f"SELECT count(*) FROM {rel}").fetchone()[0]
    distinct_rows = con.execute(
        f"SELECT count(*) FROM (SELECT DISTINCT * FROM {rel})"
    ).fetchone()[0]

    aggs = ", ".join(
        f"count({q(c)}) AS nn{i}, count(DISTINCT {q(c)}) AS d{i}, min({q(c)}) AS mn{i}, max({q(c)}) AS mx{i}"
        for i, c in enumerate(cols)
    )
    row = con.execute(f"SELECT {aggs} FROM {rel}").fetchone()

    out = [
        f"# {path.name}",
        "",
        f"- rows: **{n}**",
        f"- columns: **{len(cols)}**",
        f"- exact duplicate rows: **{n - distinct_rows}**",
    ]

    empty_cols, const_cols, table = [], [], []
    for i, c in enumerate(cols):
        nn, d, mn, mx = row[4 * i : 4 * i + 4]
        if nn == 0:
            empty_cols.append(c)
            continue
        if d == 1:
            const_cols.append(f"{c} = `{mn}`")
        table.append((c, n - nn, d, mn, mx))

    out += [
        f"- always-empty columns: **{len(empty_cols)}**",
        f"- constant columns (non-empty): **{len(const_cols)}**",
        "",
    ]

    # Key uniqueness
    for key in ("X_TRANSACTION_ID",):
        if key in cols:
            dk = con.execute(f"SELECT count(DISTINCT {key}) FROM {rel}").fetchone()[0]
            out.append(f"- distinct `{key}`: {dk} (of {n} rows)")
    out.append("")

    if const_cols:
        out += ["## Constant columns", ""] + [f"- {c}" for c in const_cols] + [""]
    if empty_cols:
        out += [
            "## Always-empty columns",
            "",
            ", ".join(f"`{c}`" for c in empty_cols),
            "",
        ]

    out += [
        "## Columns",
        "",
        "| column | nulls | distinct | min | max |",
        "|---|---|---|---|---|",
    ]
    for c, nulls, d, mn, mx in table:
        out.append(f"| `{c}` | {nulls} | {d} | {str(mn)[:30]} | {str(mx)[:30]} |")
    out.append("")

    # Top values for low-cardinality columns
    out += ["## Low-cardinality value counts (<= 25 distinct)", ""]
    for c, _nulls, d, _mn, _mx in table:
        if 1 < d <= 25:
            vals = con.execute(
                f"SELECT {q(c)}, count(*) FROM {rel} WHERE {q(c)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC"
            ).fetchall()
            out.append(f"- `{c}`: " + ", ".join(f"`{v}`×{k}" for v, k in vals))
    out.append("")

    # Time coverage and per-month volume on the first timestamp-ish column
    for c in cols:
        if (
            any(k in c.lower() for k in TS_KEYS)
            and c.upper() != "TIME_UTC_INFORMATION_YEAR"
        ):
            try:
                rows = con.execute(
                    f"SELECT strftime(try_cast({q(c)} AS TIMESTAMP), '%Y-%m') m, count(*) "
                    f"FROM {rel} GROUP BY 1 ORDER BY 1"
                ).fetchall()
            except duckdb.Error:
                continue
            out += [
                f"## Rows per month by `{c}`",
                "",
                ", ".join(f"{m}: {k}" for m, k in rows),
                "",
            ]
            break
    return "\n".join(out)


def profile_extra(con: duckdb.DuckDBPyConnection, path: Path) -> str:
    """File-specific checks beyond the generic profile."""
    name = path.name
    rel = f"read_csv('{path}', all_varchar=true, nullstr='', header=true)"
    out = ["", "## File-specific checks", ""]
    if "war" in name:
        rows = con.execute(f"SELECT WARNING_LIST FROM {rel}").fetchall()
        counts: dict[str, int] = {}
        sizes = []
        for (wl,) in rows:
            codes = [c.strip() for c in (wl or "").split(",") if c.strip()]
            sizes.append(len(codes))
            for c in codes:
                counts[c] = counts.get(c, 0) + 1
        out.append(
            f"- distinct warning codes: {len(counts)}; codes per row max {max(sizes)}, avg {sum(sizes) / len(sizes):.1f}"
        )
        out.append(
            "- top codes: "
            + ", ".join(
                f"`{c}`×{k}"
                for c, k in sorted(counts.items(), key=lambda x: -x[1])[:25]
            )
        )
        d = con.execute(
            f"SELECT count(*), count(DISTINCT WARNING_TRIGGER_OCCURRENCE_TM) FROM {rel}"
        ).fetchone()
        out.append(f"- rows: {d[0]}; distinct trigger times: {d[1]}")
        d = con.execute(
            f"SELECT count(*) FROM (SELECT WARNING_TRIGGER_OCCURRENCE_TM, WARNING_LIST FROM {rel} "
            f"GROUP BY ALL HAVING count(*) > 1)"
        ).fetchone()
        out.append(
            f"- (trigger time, warning list) pairs repeated more than once: {d[0]}"
        )
    if "dtc-d" in name:
        for col in ("ECU_NAME_MKT", "DISPLAY_DTC"):
            vals = con.execute(
                f"SELECT {col}, count(*) FROM {rel} GROUP BY 1 ORDER BY 2 DESC LIMIT 30"
            ).fetchall()
            out.append(f"- top `{col}`: " + ", ".join(f"`{v}`×{k}" for v, k in vals))
        d = con.execute(f"SELECT count(DISTINCT DISPLAY_DTC) FROM {rel}").fetchone()[0]
        out.append(f"- distinct DTC codes: {d}")
    if "ssr" in name:
        d = con.execute(
            f"SELECT count(DISTINCT X_TRANSACTION_ID), count(DISTINCT DISPLAY_DTC) FROM {rel}"
        ).fetchone()
        out.append(f"- distinct transactions: {d[0]}; distinct DTCs: {d[1]}")
    return "\n".join(out) + "\n"


def cross_checks(con: duckdb.DuckDBPyConnection, data: Path) -> str:
    def rel(prefix: str) -> str:
        f = next(data.glob(f"all-{prefix}-*.csv"))
        return f"read_csv('{f}', all_varchar=true, nullstr='', header=true)"

    out = ["# Cross-file checks", ""]
    tx = {
        p: {
            r[0]
            for r in con.execute(f"SELECT X_TRANSACTION_ID FROM {rel(p)}").fetchall()
        }
        for p in ("war", "dtc-d", "dtc-h", "dtc-ssr")
    }
    for a, ids_a in tx.items():
        for b, ids_b in tx.items():
            if a < b:
                out.append(
                    f"- X_TRANSACTION_ID overlap {a} ∩ {b}: {len(ids_a & ids_b)} "
                    f"({a}: {len(ids_a)}, {b}: {len(ids_b)})"
                )
    out.append("")
    for p, col in (
        ("war", "COPIED_DT_TM"),
        ("dtc-d", "COPIED_DT_TM"),
        ("rts", "datacreationtime"),
        ("vis", "datacreationtime"),
        ("alt", "datacreationtime"),
    ):
        mn, mx = con.execute(f"SELECT min({col}), max({col}) FROM {rel(p)}").fetchone()
        out.append(f"- `{p}` {col} range: {mn} → {mx}")
    out.append("")
    # Odometer vs time from rts and war
    mn, mx = con.execute(
        f"SELECT min(try_cast(ododispvalue_value AS DOUBLE)), max(try_cast(ododispvalue_value AS DOUBLE)) FROM {rel('rts')}"
    ).fetchone()
    out.append(f"- rts odometer range: {mn} → {mx} km")
    mn, mx = con.execute(
        f"SELECT min(try_cast(ODO_INFORMATION_KM AS DOUBLE)), max(try_cast(ODO_INFORMATION_KM AS DOUBLE)) FROM {rel('war')}"
    ).fetchone()
    out.append(f"- war odometer range: {mn} → {mx} km")
    out.append("")
    return "\n".join(out)


def profile_txt(path: Path) -> str:
    lines = path.read_text(errors="replace").splitlines()
    out = [f"# {path.name}", "", f"- lines: **{len(lines)}**", ""]
    header = [ln for ln in lines[:12] if ln.strip()]
    out += ["## Header", "", "```", *header, "```", "", "## Sections", ""]
    kv = re.compile(r"^\s+\((?P<k>[^)]+)\)\s*=\s*(?P<v>.*)$")
    section, counts, units = "(preamble)", {}, set()
    order: list[str] = []
    for ln in lines:
        m = kv.match(ln)
        if m:
            counts[section] = counts.get(section, 0) + 1
            u = re.sub(r"^[-+0-9.,\s]+", "", m["v"]).strip()
            if u:
                units.add(u)
        elif ln.strip() and not ln.startswith(" "):
            section = ln.strip()
            if section not in counts:
                counts[section] = 0
                order.append(section)
    for s in order:
        out.append(f"- {s}: {counts[s]} key/value lines")
    out += [
        "",
        "## Value suffixes seen (units / non-numeric)",
        "",
        ", ".join(f"`{u}`" for u in sorted(units)),
        "",
    ]
    other = [
        ln for ln in lines if ln.strip() and not kv.match(ln) and ln.startswith(" ")
    ]
    out += [
        f"## Indented lines not matching `(KEY) = value` ({len(other)})",
        "",
        "```",
        *other[:40],
        "```",
        "",
    ]
    return "\n".join(out)


def main(data_dir: str, out_dir: str) -> None:
    data, out = Path(data_dir), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    for f in sorted(data.glob("*.csv")):
        (out / f"{f.stem}.md").write_text(profile_csv(con, f) + profile_extra(con, f))
        print("profiled", f.name)
    for f in sorted(data.glob("*.txt")):
        (out / f"{f.stem}.md").write_text(profile_txt(f))
        print("profiled", f.name)
    (out / "cross-checks.md").write_text(cross_checks(con, data))
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
