"""Look for co-occurrences between `$xxx` warning codes, `vdt_*` warning-lamp flags and DTCs.

Reads a model's database (built by `make ingest`), not the raw CSVs, so it uses the same parsing and
time stamps as the dashboard. Read-only. Prints nothing that identifies the car (no VIN, no position).

What it prints:
  1. every DTC read-out started by a warning event (they share WARNING_TRIGGER_OCCURRENCE_TM): the
     warning codes of that event and the DTCs that are NEW in that read-out compared with the previous one;
  2. per warning code, how often each new DTC came in a read-out the code started;
  3. per flag, every off->on and on->off change: the interval between the two status reports and the
     warning codes (and new DTCs) inside it. Flags are only sampled at status reports, hours apart, so a
     change can only be placed within that interval;
  4. rare warning codes (< 40 events): their dates and the flags on at the next status report.

The output is a list of HINTS. A co-occurrence is not a meaning: never turn it into a title in
config/models/<id>/codes/*.yaml, put it in `notes` (marked as a hint) if it is worth keeping.

Usage (from the repository root):
    cd backend && uv run python ../scripts/correlate_mazda_warnings.py [--model cx5] [--db path/to.duckdb]
"""

import argparse

import duckdb

from mazda_dash.models import load_registry


def show(con: duckdb.DuckDBPyConnection, title: str, sql: str) -> None:
    print(f"\n=== {title}")
    cur = con.execute(sql)
    print(" | ".join(d[0] for d in cur.description))
    for row in cur.fetchall():
        print(" | ".join("" if v is None else str(v) for v in row))


def report(con: duckdb.DuckDBPyConnection) -> None:
    # Read-outs in time order, each with the one before it.
    con.execute("""
        CREATE TEMP TABLE ro AS
        SELECT transaction_id, triggered_at, copied_at,
               lag(transaction_id) OVER (ORDER BY coalesce(triggered_at, copied_at), transaction_id) AS prev_id
        FROM dtc_headers""")
    # DTCs present in a read-out but not in the previous one (same ECU and code).
    con.execute("""
        CREATE TEMP TABLE new_dtc AS
        SELECT r.transaction_id, r.triggered_at, d.ecu,
               d.dtc_code || ':' || coalesce(d.failure_type, '') AS dtc
        FROM ro r JOIN dtc_readings d USING (transaction_id)
        WHERE d.kind = 'fault' AND NOT EXISTS (
            SELECT 1 FROM dtc_readings p
            WHERE p.transaction_id = r.prev_id AND p.kind = 'fault'
              AND p.ecu = d.ecu AND p.dtc_code = d.dtc_code)""")
    # Flag changes between consecutive status reports.
    for name, condition in (
        ("edges_on", "is_on AND NOT prev_on"),
        ("edges_off", "NOT is_on AND prev_on"),
    ):
        con.execute(f"""
            CREATE TEMP TABLE {name} AS
            WITH r AS (
                SELECT flag, read_at, is_on,
                       lag(is_on) OVER (PARTITION BY flag ORDER BY read_at) AS prev_on,
                       lag(read_at) OVER (PARTITION BY flag ORDER BY read_at) AS prev_at
                FROM v_warning_flag_readings)
            SELECT flag, prev_at, read_at FROM r WHERE prev_on IS NOT NULL AND {condition}""")

    show(
        con,
        "Read-outs started by a warning event: its warning codes and the DTCs new in the read-out",
        """
        SELECT r.triggered_at,
               (SELECT string_agg(DISTINCT code, ' ' ORDER BY code) FROM v_warnings w
                 WHERE w.triggered_at = r.triggered_at) AS warning_codes,
               (SELECT string_agg(ecu || ' ' || dtc, ', ' ORDER BY ecu, dtc) FROM new_dtc n
                 WHERE n.transaction_id = r.transaction_id) AS new_dtcs
        FROM ro r WHERE r.triggered_at IS NOT NULL
        ORDER BY r.triggered_at, r.transaction_id""",
    )

    show(
        con,
        "Warning code x new DTC: read-outs with both, out of the read-outs the code started",
        """
        WITH wr AS (SELECT DISTINCT w.code, r.transaction_id
                    FROM v_warnings w JOIN ro r ON r.triggered_at = w.triggered_at),
             tot AS (SELECT code, count(*) AS n FROM wr GROUP BY code)
        SELECT wr.code, n.ecu || ' ' || n.dtc AS dtc, count(*) AS together,
               any_value(tot.n) AS readouts_of_code
        FROM wr JOIN new_dtc n USING (transaction_id) JOIN tot USING (code)
        GROUP BY ALL ORDER BY code, together DESC, dtc""",
    )

    for table, label in (("edges_on", "off -> on"), ("edges_off", "on -> off")):
        show(
            con,
            f"Flag {label}: the interval between status reports and what happened inside it",
            f"""
            SELECT e.flag, e.prev_at, e.read_at,
                   round(date_diff('minute', e.prev_at, e.read_at) / 60.0, 1) AS hours,
                   (SELECT string_agg(code || '×' || n, ' ' ORDER BY n DESC, code) FROM
                      (SELECT code, count(*) AS n FROM v_warnings w
                        WHERE w.triggered_at > e.prev_at AND w.triggered_at <= e.read_at
                        GROUP BY code)) AS warnings,
                   (SELECT string_agg(ecu || ' ' || dtc, ', ' ORDER BY ecu, dtc) FROM new_dtc n
                     WHERE n.triggered_at > e.prev_at AND n.triggered_at <= e.read_at) AS new_dtcs
            FROM {table} e ORDER BY e.flag, e.read_at""",
        )

    show(
        con,
        "Rare warning codes (< 40 events): dates and the flags on at the next status report",
        """
        WITH w AS (SELECT code, triggered_at FROM v_warnings
                   WHERE code IN (SELECT code FROM v_warnings GROUP BY code HAVING count(*) < 40)),
             nxt AS (SELECT w.code, w.triggered_at,
                            (SELECT min(read_at) FROM v_warning_flag_readings r
                              WHERE r.read_at >= w.triggered_at) AS next_at
                     FROM w)
        SELECT code, count(*) AS events, count(DISTINCT CAST(triggered_at AS DATE)) AS days,
               string_agg(DISTINCT CAST(CAST(triggered_at AS DATE) AS VARCHAR), ' '
                          ORDER BY CAST(CAST(triggered_at AS DATE) AS VARCHAR)) AS dates,
               (SELECT string_agg(DISTINCT r.flag, ' ' ORDER BY r.flag)
                  FROM v_warning_flag_readings r JOIN nxt n2 ON r.read_at = n2.next_at AND n2.code = nxt.code
                 WHERE r.is_on) AS flags_on_next
        FROM nxt GROUP BY code ORDER BY events DESC, code""",
    )

    show(
        con, "Diagnostic reports", "SELECT taken_at FROM diag_reports ORDER BY taken_at"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--model", help="model id (default: the default model)")
    parser.add_argument(
        "--db", help="database file (default: the model's db/<id>.duckdb)"
    )
    args = parser.parse_args()

    registry = load_registry()
    model = registry.get(args.model) if args.model else registry.default
    db = args.db or str(model.db_path)
    print(f"Model {model.id} ({model.name}), database {db}")
    print("Co-occurrences are hints, not meanings.")
    report(duckdb.connect(db, read_only=True))


if __name__ == "__main__":
    main()
