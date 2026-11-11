"""``make compat``: what the views read against what a model's data holds."""

import duckdb
import pytest

from mazda_dash.compat import compat_report, format_report, views_reading
from mazda_dash.ingest.schema import init_schema

SQL = """
CREATE OR REPLACE VIEW v_a AS SELECT * FROM signal_readings WHERE signal = 'fuel' OR signal = 'odo';
CREATE OR REPLACE VIEW v_b AS SELECT * FROM signal_readings WHERE starts_with(signal, 'flag_') AND signal = 'odo';
CREATE OR REPLACE VIEW v_c AS SELECT 1;
"""


@pytest.fixture
def con():
    con = duckdb.connect()
    init_schema(con)
    rows = [
        ("odo", "1", 1.0, True),
        ("fuel", "x", None, False),  # present, but never valid
        ("flag_1", "0", 0.0, True),
        ("flag_1", "1", 1.0, True),
        ("flag_2", "0", 0.0, True),
        ("extra_signal", "5", 5.0, True),
    ]
    for signal, value, num, valid in rows:
        con.execute(
            "INSERT INTO signal_readings VALUES ('rts', 'V', 'r', now(), now(), ?, ?, ?, ?)",
            [signal, value, num, valid],
        )
    con.execute("INSERT INTO ingest_runs VALUES (now(), 'f.csv', 'war', 3, 3)")
    con.execute("INSERT INTO ingest_runs VALUES (now(), 'g.csv', 'rts', 0, 0)")
    return con


def test_views_reading_a_signal():
    assert views_reading(SQL, "signal = 'odo'") == ["v_a", "v_b"]
    assert views_reading(SQL, "starts_with(signal, 'flag_')") == ["v_b"]
    assert views_reading(SQL, "signal = 'nope'") == []


def test_report(con):
    sql = SQL.replace("OR signal = 'odo'", "OR signal = 'odo' OR signal = 'gone'")
    r = compat_report(con, sql)
    assert [m["signal"] for m in r["missing"]] == ["gone"]
    assert r["missing"][0]["views"] == ["v_a"]
    assert [m["signal"] for m in r["never_valid"]] == ["fuel"]
    assert r["families"] == [
        {"prefix": "flag_", "signals": 2, "varying": 1, "views": ["v_b"]}
    ]
    assert r["unread"] == ["extra_signal"]
    assert r["kinds_loaded"] == ["war"]  # a kind that read no rows is not loaded
    assert "rts" in r["kinds_missing"]
    text = format_report("Test", r)
    assert "missing" in text and "gone  ->  v_a" in text and "1 of 5 signals" in text
