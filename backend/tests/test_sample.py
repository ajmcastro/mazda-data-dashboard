"""The synthetic sample data must load through the real pipeline and exercise the features."""

import duckdb
import pytest

from mazda_dash.alerts import evaluate
from mazda_dash.ingest import ingest
from mazda_dash.sample import VIN, generate

CONFIG = __import__("pathlib").Path(__file__).parents[2] / "config"


@pytest.fixture(scope="module")
def con(tmp_path_factory):
    root = tmp_path_factory.mktemp("sample")
    generate(root / "data")
    db = root / "demo.duckdb"
    results = ingest(root / "data", db, CONFIG / "codes")
    assert {kind for kind, *_ in results} == {
        "war",
        "dtc-h",
        "dtc-d",
        "dtc-ssr",
        "rts",
        "vis",
        "alt",
        "diag",
    }
    assert all(new > 0 for *_, new in results)
    evaluate(db, CONFIG / "alerts.yaml")
    con = duckdb.connect(str(db), read_only=True)
    yield con
    con.close()


def q(con, sql):
    return con.execute(sql).fetchall()


def test_only_the_sample_vin_is_present(con):
    assert q(con, "SELECT DISTINCT vin FROM warning_events") == [(VIN,)]
    assert q(
        con,
        "SELECT count(*) FROM signal_readings WHERE signal IN ('latitude','longitude') AND value IS NOT NULL",
    ) == [(0,)]


def test_every_feature_has_data(con):
    assert q(con, "SELECT count(*) > 100 FROM v_trip_segments") == [(True,)]
    assert q(con, "SELECT count(*) >= 3 FROM v_fuel_monthly") == [(True,)]
    assert q(
        con, "SELECT count(*) FROM v_dtc_frequency WHERE active_in_latest_readout"
    ) == [(2,)]
    assert q(
        con, "SELECT count(*) FROM v_dtc_readout_summary WHERE read_errors > 0"
    ) == [(2,)]
    assert q(con, "SELECT count(*) FROM diag_reports") == [
        (3,)
    ]  # three diagnostic reports
    assert q(con, "SELECT count(*) FROM v_diag_obd WHERE in_range") == [
        (12,)
    ]  # 4 monitors each
    assert q(con, "SELECT count(*) FROM v_freeze_frames")[0][0] > 5


def test_expected_alerts_are_raised(con):
    rules = {r for (r,) in q(con, "SELECT DISTINCT rule FROM alerts")}
    assert {
        "new_dtc",
        "recurring_dtc",
        "new_warning_code",
        "warning_spike",
        "burglar_alarm",
        "high_consumption",
        "low_tire_pressure",
    } <= rules


def test_sample_data_does_not_depend_on_the_machines_time_zone(tmp_path, monkeypatch):
    """CI runs in UTC, developers do not: the committed sample files must be byte-identical anywhere."""
    import time

    def build(tz: str, name: str) -> dict[str, bytes]:
        monkeypatch.setenv("TZ", tz)
        time.tzset()
        out = tmp_path / name
        generate(out)
        return {p.name: p.read_bytes() for p in sorted(out.iterdir())}

    try:
        utc = build("UTC", "utc")
        assert build("Pacific/Auckland", "nz") == utc
        assert build("America/New_York", "ny") == utc
    finally:
        monkeypatch.undo()
        time.tzset()
