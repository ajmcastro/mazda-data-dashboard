"""Loaders for the CSV exports. Each loader is idempotent: rows whose key is
already in the target table are skipped, and duplicates inside a file collapse
to one row. Every loader returns ``(rows_read, rows_new)``."""

from pathlib import Path

import duckdb

DTC_RE = r"^(X?[PCBU][0-9A-F]{4}):([0-9A-F]{2})$"

# Sentinels that mean "unknown" in the raw data.
INT32_MAX = 2147483647


def _src(path: Path) -> str:
    p = str(path).replace("'", "''")
    return f"read_csv('{p}', all_varchar=true, nullstr='', header=true)"


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _ts_z(col: str) -> str:
    return f"try_strptime({col}, '%Y-%m-%dT%H:%M:%SZ')"


def _ts_naive(col: str) -> str:
    return f"try_cast({col} AS TIMESTAMP)"


def _odo(col: str) -> str:
    return f"CASE WHEN try_cast({col} AS DOUBLE) < 0 THEN NULL ELSE try_cast({col} AS DOUBLE) END"


def _insert_new(
    con: duckdb.DuckDBPyConnection, table: str, select_sql: str, keys: list[str]
) -> int:
    on = " AND ".join(f"t.{k} IS NOT DISTINCT FROM s.{k}" for k in keys)
    part = ", ".join(f"s.{k}" for k in keys)
    sql = (
        f"INSERT INTO {table} SELECT s.* FROM ({select_sql}) s "
        f"WHERE NOT EXISTS (SELECT 1 FROM {table} t WHERE {on}) "
        f"QUALIFY row_number() OVER (PARTITION BY {part}) = 1"
    )
    return con.execute(sql).fetchone()[0]


def _count(con: duckdb.DuckDBPyConnection, path: Path) -> int:
    return con.execute(f"SELECT count(*) FROM {_src(path)}").fetchone()[0]


def load_war(con: duckdb.DuckDBPyConnection, path: Path) -> tuple[int, int]:
    select = f"""
        SELECT X_TRANSACTION_ID AS transaction_id, VIN AS vin,
               {_ts_naive("COPIED_DT_TM")} AS copied_at,
               {_ts_z("WARNING_TRIGGER_OCCURRENCE_TM")} AS triggered_at,
               NULLIF(try_cast(HOURS AS BIGINT), {INT32_MAX}) AS hours,
               NULLIF(try_cast(MINUTES AS BIGINT), {INT32_MAX}) AS minutes,
               {_odo("ODO_INFORMATION_KM")} AS odometer_km,
               WARNING_LIST AS warning_list
        FROM {_src(path)}"""
    new = _insert_new(con, "warning_events", select, ["transaction_id"])
    # One row per code, derived from the stored list so it also repairs partial loads.
    codes = """
        SELECT transaction_id, code FROM (
            SELECT transaction_id, trim(unnest(string_split(warning_list, ','))) AS code
            FROM warning_events
        ) WHERE code <> ''"""
    _insert_new(con, "warning_codes", codes, ["transaction_id", "code"])
    return _count(con, path), new


def load_dtc_h(con: duckdb.DuckDBPyConnection, path: Path) -> tuple[int, int]:
    select = f"""
        SELECT X_TRANSACTION_ID AS transaction_id, VIN AS vin,
               {_ts_naive("COPIED_DT_TM")} AS copied_at,
               {_ts_z("DIAGNOSTICS_ACQUISITION_TM")} AS acquired_at,
               {_ts_z("WARNING_TRIGGER_OCCURRENCE_TM")} AS triggered_at,
               {_odo("ODO_INFORMATION_KM")} AS odometer_km
        FROM {_src(path)}"""
    return _count(con, path), _insert_new(
        con, "dtc_headers", select, ["transaction_id"]
    )


def _dtc_cols(col: str) -> str:
    """kind / dtc_code / failure_type expressions for a raw DTC column."""
    kind = (
        f"CASE WHEN {col} IS NULL THEN 'none' "
        f"WHEN regexp_full_match({col}, '{DTC_RE}') THEN 'fault' ELSE 'read_error' END"
    )
    code = f"NULLIF(regexp_extract({col}, '{DTC_RE}', 1), '')"
    ftype = f"NULLIF(regexp_extract({col}, '{DTC_RE}', 2), '')"
    return (
        f"{kind} AS kind, {col} AS raw_dtc, {code} AS dtc_code, {ftype} AS failure_type"
    )


def load_dtc_d(con: duckdb.DuckDBPyConnection, path: Path) -> tuple[int, int]:
    select = f"""
        SELECT X_TRANSACTION_ID AS transaction_id, ECU_NAME_MKT AS ecu,
               {_dtc_cols("DISPLAY_DTC")},
               try_cast(STATUS_CODE AS INTEGER) AS status_code,
               DISPLAY_STATUS AS display_status,
               try_cast(DTC_STATUS_FLAG AS INTEGER) AS status_flag
        FROM {_src(path)}"""
    return _count(con, path), _insert_new(
        con, "dtc_readings", select, ["transaction_id", "ecu", "raw_dtc"]
    )


# Metadata columns of the snapshot file; every other column is a signal.
SSR_META = [
    "X_TRANSACTION_ID",
    "VIN",
    "COPIED_DT_TM",
    "DIAGNOSTICS_ACQUISITION_TM",
    "WARNING_TRIGGER_OCCURRENCE_TM",
    "HOURS",
    "MINUTES",
    "ODO_INFORMATION_KM",
    "ECU_NAME_MKT",
    "STATUS_CODE",
    "DISPLAY_DTC",
    "DISPLAY_STATUS",
    "DTC_STATUS_FLAG",
    "DTC_SNAPSHOT_RECORD_NUMBER",
    "Time_UTC_Information_Year",
    "Time_UTC_Information_Month",
    "Time_UTC_Information_Date",
    "Time_UTC_Information_Hour",
    "Time_UTC_Information_Minute",
    "Time_UTC_Information_Second",
]


def load_dtc_ssr(con: duckdb.DuckDBPyConnection, path: Path) -> tuple[int, int]:
    t = "Time_UTC_Information_"
    snap_at = (
        "try_cast(make_timestamp("
        f"try_cast({t}Year AS INTEGER), try_cast({t}Month AS INTEGER), "
        f"try_cast({t}Date AS INTEGER), try_cast({t}Hour AS INTEGER), "
        f"try_cast({t}Minute AS INTEGER), try_cast({t}Second AS DOUBLE)) AS TIMESTAMP)"
    )
    header = f"""
        SELECT X_TRANSACTION_ID AS transaction_id, ECU_NAME_MKT AS ecu,
               DISPLAY_DTC AS raw_dtc, DTC_SNAPSHOT_RECORD_NUMBER AS record_number,
               NULLIF(regexp_extract(DISPLAY_DTC, '{DTC_RE}', 1), '') AS dtc_code,
               NULLIF(regexp_extract(DISPLAY_DTC, '{DTC_RE}', 2), '') AS failure_type,
               DISPLAY_STATUS AS display_status,
               try_cast(DTC_STATUS_FLAG AS INTEGER) AS status_flag,
               {_ts_naive("COPIED_DT_TM")} AS copied_at,
               {_ts_z("WARNING_TRIGGER_OCCURRENCE_TM")} AS triggered_at,
               {_odo("ODO_INFORMATION_KM")} AS odometer_km,
               {snap_at} AS snapshot_at
        FROM {_src(path)}"""
    keys = ["transaction_id", "ecu", "raw_dtc", "record_number"]
    new = _insert_new(con, "dtc_snapshots", header, keys)

    exclude = ", ".join(_q(c) for c in SSR_META)
    values = f"""
        SELECT X_TRANSACTION_ID AS transaction_id, ECU_NAME_MKT AS ecu,
               DISPLAY_DTC AS raw_dtc, DTC_SNAPSHOT_RECORD_NUMBER AS record_number,
               signal, value, try_cast(value AS DOUBLE) AS value_num
        FROM (
            UNPIVOT {_src(path)}
            ON COLUMNS(* EXCLUDE ({exclude}))
            INTO NAME signal VALUE value
        )"""
    _insert_new(con, "dtc_snapshot_values", values, [*keys, "signal"])
    return _count(con, path), new


def load_signals(
    con: duckdb.DuckDBPyConnection, path: Path, source: str
) -> tuple[int, int]:
    """rts / vis / alt. Most signals come as ``<signal>_value`` + ``<signal>_validstatus``
    column pairs; the rest (seat belts, warning bit flags, latitude/longitude) are
    plain columns without a validity flag."""
    cols = [
        r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {_src(path)}").fetchall()
    ]
    meta = {"vin", "fileid_datetime", "requesttype", "datacreationtime"}
    value_cols = [c for c in cols if c not in meta and not c.endswith("_validstatus")]
    flag_cols = [c for c in cols if c.endswith("_validstatus")]
    req = "requesttype" if "requesttype" in cols else "NULL"

    def unpivot(wanted: list[str], suffix: str, alias: str) -> str:
        pick = ", ".join(_q(c) for c in wanted)
        return f"""
            SELECT vin, datacreationtime,
                   regexp_replace(col, '{suffix}$', '') AS signal, v AS {alias}
            FROM (SELECT vin, datacreationtime, {pick} FROM {_src(path)})
                 UNPIVOT INCLUDE NULLS (v FOR col IN ({pick}))"""

    vals = unpivot(value_cols, "_value", "value")
    if flag_cols:
        flags = unpivot(flag_cols, "_validstatus", "validstatus")
        join = f"LEFT JOIN ({flags}) f USING (vin, datacreationtime, signal)"
        valid_expr = "(f.validstatus = 'Valid')"
    else:
        join, valid_expr = "", "NULL::BOOLEAN"
    select = f"""
        SELECT '{source}' AS source, vin, m.request_type,
               {_ts_z("datacreationtime")} AS created_at,
               {_ts_naive("m.fileid_datetime")} AS file_at,
               signal, v.value, try_cast(v.value AS DOUBLE) AS value_num,
               {valid_expr} AS valid
        FROM ({vals}) v
        JOIN (SELECT vin, datacreationtime, fileid_datetime, {req} AS request_type
              FROM {_src(path)}) m USING (vin, datacreationtime)
        {join}"""
    new = _insert_new(
        con, "signal_readings", select, ["source", "vin", "created_at", "signal"]
    )
    return _count(con, path), new


LOADERS = {
    "war": load_war,
    "dtc-h": load_dtc_h,
    "dtc-d": load_dtc_d,
    "dtc-ssr": load_dtc_ssr,
    "rts": lambda con, p: load_signals(con, p, "rts"),
    "vis": lambda con, p: load_signals(con, p, "vis"),
    "alt": lambda con, p: load_signals(con, p, "alt"),
}
# dtc-h must precede nothing in particular, but keep a stable, documented order.
ORDER = ["war", "dtc-h", "dtc-d", "dtc-ssr", "rts", "vis", "alt"]
