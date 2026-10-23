from datetime import datetime

import duckdb
import pytest

from mazda_dash.ingest import ingest


@pytest.fixture
def con(data_dir, tmp_path):
    db = tmp_path / "db" / "test.duckdb"
    ingest(data_dir, db)
    con = duckdb.connect(str(db))
    yield con
    con.close()


def q(con, sql):
    return con.execute(sql).fetchall()


def test_rerun_is_idempotent(data_dir, tmp_path):
    db = tmp_path / "x.duckdb"
    first = ingest(data_dir, db)
    second = ingest(data_dir, db)
    assert all(new == 0 for *_, new in second)
    assert sum(new for *_, new in first) > 0
    con = duckdb.connect(str(db))
    assert q(con, "SELECT count(*) FROM warning_events") == [(2,)]
    assert q(con, "SELECT count(*) FROM warning_codes") == [(4,)]


def test_warning_sentinels_become_null(con):
    row = q(
        con,
        "SELECT hours, minutes, odometer_km, triggered_at FROM warning_events "
        "WHERE transaction_id = 'tx-w2'",
    )[0]
    assert row == (None, None, None, datetime(2026, 6, 13, 9, 23, 57))


def test_warning_list_is_exploded(con):
    codes = q(
        con, "SELECT code FROM warning_codes WHERE transaction_id = 'tx-w1' ORDER BY 1"
    )
    assert codes == [("$182",), ("$210",), ("$21D",)]


def test_dtc_kinds(con):
    rows = q(
        con, "SELECT ecu, kind, dtc_code, failure_type FROM dtc_readings ORDER BY ecu"
    )
    assert rows == [
        ("ADU", "fault", "C1681", "13"),
        ("BCM", "none", None, None),
        ("DCM", "read_error", None, None),
    ]


def test_dtc_header_and_snapshot(con):
    assert q(con, "SELECT acquired_at, odometer_km FROM dtc_headers") == [(None, 59.0)]
    assert q(con, "SELECT snapshot_at, dtc_code FROM dtc_snapshots") == [
        (datetime(2026, 6, 9, 14, 34, 17), "C1A0F")
    ]
    # empty signal columns are dropped; only non-empty signals are stored
    assert q(con, "SELECT signal, value_num FROM dtc_snapshot_values") == [
        ("Vehicle_Speed", 12.5)
    ]


def test_signal_readings_validity_and_plain_columns(con):
    rows = {
        s: (v, ok)
        for s, v, ok in q(
            con,
            "SELECT signal, value_num, valid FROM signal_readings WHERE source = 'rts'",
        )
    }
    assert rows["ododispvalue"] == (59.1, True)
    assert rows["enginestate"] == (3.0, False)  # flagged Invalid
    assert rows["latitude"] == (41.1, None)  # no validity column
    assert q(con, "SELECT valid FROM signal_readings WHERE source = 'alt'") == [(True,)]


def test_diag_report(con):
    report = q(con, "SELECT vin, taken_at, odometer_km FROM diag_reports")[0]
    # 09:56:59 at UTC+01:00 is 08:56:59 UTC
    assert report == ("TESTVIN0000000001", datetime(2026, 10, 15, 8, 56, 59), 5781.0)
    assert q(con, "SELECT value_num, unit FROM diag_values WHERE key = 'ERT_R'") == [
        (42327.0, "s")
    ]
    # UINT32_MAX means "not available"
    assert q(con, "SELECT value_num FROM diag_values WHERE key = 'OCCT1_TIME1_R'") == [
        (None,)
    ]
    # identifiers are not numbers, repeated keys get a sequence number
    assert q(
        con,
        "SELECT seq, value, value_num FROM diag_values WHERE key = 'AESIDx' ORDER BY seq",
    ) == [(1, "1814", None), (2, "181A", None)]
    assert q(
        con, "SELECT list_name, ecu, dtc_code, status_byte FROM diag_dtcs ORDER BY 1"
    ) == [
        ("dtcs", "ADU", "C1C83", "28"),
        ("rob_dtcs", "DCM", "XB2A92", "28"),
    ]
    assert q(
        con,
        "SELECT signal, value_num, unit, record_number FROM diag_snapshots ORDER BY 1",
    ) == [
        ("APP", 15.5, "%", "01"),
        ("POWER_MODE", None, None, "01"),
    ]
    assert q(
        con,
        "SELECT obdmid, test, min_value, max_value, value, unit FROM diag_obd_tests",
    ) == [
        ("2", "3", 300.171, 310.0, 300.171, "mV"),
        ("A2", "B", 0.0, 65535.0, 1.0, None),
    ]
