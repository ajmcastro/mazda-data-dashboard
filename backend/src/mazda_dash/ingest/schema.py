"""DuckDB schema for the ingested Mazda data.

All timestamps are naive TIMESTAMPs holding UTC. Sentinel values from the raw
exports (INT32_MAX hours/minutes, odometer -1, UINT32_MAX counters) are stored as NULL.
"""

import duckdb

DDL = [
    """
    CREATE TABLE IF NOT EXISTS warning_events (
        transaction_id VARCHAR,
        vin VARCHAR,
        copied_at TIMESTAMP,
        triggered_at TIMESTAMP,
        hours BIGINT,
        minutes BIGINT,
        odometer_km DOUBLE,
        warning_list VARCHAR
    )""",
    """
    CREATE TABLE IF NOT EXISTS warning_codes (
        transaction_id VARCHAR,
        code VARCHAR
    )""",
    """
    CREATE TABLE IF NOT EXISTS dtc_headers (
        transaction_id VARCHAR,
        vin VARCHAR,
        copied_at TIMESTAMP,
        acquired_at TIMESTAMP,
        triggered_at TIMESTAMP,
        odometer_km DOUBLE
    )""",
    # kind: 'none' (ECU reported no DTC), 'fault' (well-formed DTC) or
    # 'read_error' (raw diagnostic-protocol text such as '19 02 8F').
    """
    CREATE TABLE IF NOT EXISTS dtc_readings (
        transaction_id VARCHAR,
        ecu VARCHAR,
        kind VARCHAR,
        raw_dtc VARCHAR,
        dtc_code VARCHAR,
        failure_type VARCHAR,
        status_code INTEGER,
        display_status VARCHAR,
        status_flag INTEGER
    )""",
    """
    CREATE TABLE IF NOT EXISTS dtc_snapshots (
        transaction_id VARCHAR,
        ecu VARCHAR,
        raw_dtc VARCHAR,
        record_number VARCHAR,
        dtc_code VARCHAR,
        failure_type VARCHAR,
        display_status VARCHAR,
        status_flag INTEGER,
        copied_at TIMESTAMP,
        triggered_at TIMESTAMP,
        odometer_km DOUBLE,
        snapshot_at TIMESTAMP
    )""",
    # Only non-empty signals are stored (the wide source file is >80% empty).
    """
    CREATE TABLE IF NOT EXISTS dtc_snapshot_values (
        transaction_id VARCHAR,
        ecu VARCHAR,
        raw_dtc VARCHAR,
        record_number VARCHAR,
        signal VARCHAR,
        value VARCHAR,
        value_num DOUBLE
    )""",
    # Long format for rts / vis / alt. valid is NULL when the source has no
    # validity column for the signal; value_num is NULL for non-numeric text.
    """
    CREATE TABLE IF NOT EXISTS signal_readings (
        source VARCHAR,
        vin VARCHAR,
        request_type VARCHAR,
        created_at TIMESTAMP,
        file_at TIMESTAMP,
        signal VARCHAR,
        value VARCHAR,
        value_num DOUBLE,
        valid BOOLEAN
    )""",
    """
    CREATE TABLE IF NOT EXISTS diag_reports (
        report_id VARCHAR,
        source_file VARCHAR,
        vin VARCHAR,
        taken_at TIMESTAMP,
        odometer_km DOUBLE
    )""",
    """
    CREATE TABLE IF NOT EXISTS diag_values (
        report_id VARCHAR,
        ecu VARCHAR,
        section VARCHAR,
        seq INTEGER,
        key VARCHAR,
        value VARCHAR,
        value_num DOUBLE,
        unit VARCHAR
    )""",
    # list_name: 'dtcs' or 'rob_dtcs' (the two DTC lists in the tool output).
    """
    CREATE TABLE IF NOT EXISTS diag_dtcs (
        report_id VARCHAR,
        list_name VARCHAR,
        ecu VARCHAR,
        dtc_code VARCHAR,
        failure_type VARCHAR,
        status_byte VARCHAR
    )""",
    """
    CREATE TABLE IF NOT EXISTS diag_snapshots (
        report_id VARCHAR,
        ecu VARCHAR,
        dtc_code VARCHAR,
        failure_type VARCHAR,
        status_byte VARCHAR,
        record_number VARCHAR,
        signal VARCHAR,
        value VARCHAR,
        value_num DOUBLE,
        unit VARCHAR
    )""",
    """
    CREATE TABLE IF NOT EXISTS diag_obd_tests (
        report_id VARCHAR,
        ecu VARCHAR,
        obdmid VARCHAR,
        test VARCHAR,
        min_value DOUBLE,
        max_value DOUBLE,
        value DOUBLE,
        unit VARCHAR
    )""",
    """
    CREATE TABLE IF NOT EXISTS ingest_runs (
        run_at TIMESTAMP,
        source_file VARCHAR,
        kind VARCHAR,
        rows_read BIGINT,
        rows_new BIGINT
    )""",
]


def init_schema(con: duckdb.DuckDBPyConnection) -> None:
    for stmt in DDL:
        con.execute(stmt)
