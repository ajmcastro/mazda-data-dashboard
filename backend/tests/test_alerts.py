from datetime import datetime
from pathlib import Path

import duckdb
import pytest

from mazda_dash.alerts import evaluate
from mazda_dash.alerts.config import AlertsConfig, load_config
from mazda_dash.alerts.engine import run_alerts
from mazda_dash.alerts.notify import notify_desktop, summary
from mazda_dash.alerts.store import Candidate
from mazda_dash.ingest import ingest

NOW = datetime(2026, 10, 16, 12, 0)  # the day after the fixture's newest data point


@pytest.fixture
def con(data_dir, tmp_path):
    db = tmp_path / "a.duckdb"
    config = tmp_path / "codes"
    config.mkdir()
    ingest(data_dir, db, config)
    con = duckdb.connect(str(db))
    yield con
    con.close()


def cfg(**kwargs) -> AlertsConfig:
    # the fixture data is months old relative to its newest point, so widen the window
    return AlertsConfig.model_validate({"lookback_days": 400, **kwargs})


def keys(created):
    return sorted(c.dedup_key for c in created)


def test_events_become_alerts(con):
    created = run_alerts(con, cfg(), now=NOW)
    assert "burglar_alarm:20261018T102929" not in keys(created)  # not in the fixture
    ks = keys(created)
    assert "burglar_alarm:20260816T084602" in ks
    assert "new_dtc:ADU:C1681:13" in ks
    assert any(k.startswith("new_warning_code:") for k in ks)
    alarm = next(c for c in created if c.rule == "burglar_alarm")
    assert alarm.severity == "critical" and "status 5" in alarm.detail


def test_rerun_raises_nothing_new_and_keeps_status(con):
    first = run_alerts(con, cfg(), now=NOW)
    assert first
    con.execute(
        "UPDATE alerts SET status = 'acknowledged' WHERE rule = 'burglar_alarm'"
    )
    assert run_alerts(con, cfg(), now=NOW) == []
    status = con.execute(
        "SELECT status FROM alerts WHERE rule = 'burglar_alarm'"
    ).fetchone()
    assert status == ("acknowledged",)  # an acknowledged alert is not raised again


def test_lookback_ignores_old_events(con):
    created = run_alerts(con, cfg(lookback_days=30), now=NOW)
    assert not [c for c in created if c.rule in ("burglar_alarm", "new_dtc")]


def test_rules_can_be_disabled_and_severity_overridden(con):
    created = run_alerts(
        con,
        cfg(
            rules={
                "burglar_alarm": {"enabled": False},
                "new_dtc": {"severity": "critical"},
            }
        ),
        now=NOW,
    )
    assert not [c for c in created if c.rule == "burglar_alarm"]
    dtc = next(c for c in created if c.rule == "new_dtc")
    assert (
        dtc.severity == "critical"
    )  # the DTC has no severity in the lookup, so the rule's applies


def test_data_gap_uses_the_clock(con):
    quiet = run_alerts(con, cfg(rules={"data_gap": {"max_days": 3}}), now=NOW)
    assert not [c for c in quiet if c.rule == "data_gap"]
    late = run_alerts(
        con, cfg(rules={"data_gap": {"max_days": 3}}), now=datetime(2026, 10, 25)
    )
    gap = next(c for c in late if c.rule == "data_gap")
    assert "9 days" in gap.title and gap.dedup_key == "data_gap:2026-10-15"


def test_low_tire_pressure_and_low_fuel(con):
    con.execute(
        "INSERT INTO signal_readings VALUES ('rts','V',NULL,'2026-10-15 12:00:00',NULL,"
        "'fltprsdispkp','190',190,TRUE)"
    )
    con.execute(
        "INSERT INTO signal_readings VALUES ('rts','V',NULL,'2026-10-15 12:00:00',NULL,"
        "'fuelsegementdactl','8',8,TRUE)"
    )
    created = run_alerts(con, cfg(), now=NOW)
    tire = next(c for c in created if c.rule == "low_tire_pressure")
    assert "front left" in tire.title and "190" in tire.title
    assert any(c.rule == "low_fuel" for c in created)


def test_warning_spike_needs_volume_and_outlier(con):
    # 30 quiet days of 1 event, then a day with 40
    rows = [(f"s{d}", f"2026-09-{d:02d} 10:00:00", 1) for d in range(1, 29)]
    rows.append(("big", "2026-10-10 10:00:00", 40))
    for tx, ts, n in rows:
        for i in range(n):
            con.execute(
                "INSERT INTO warning_events (transaction_id, triggered_at) VALUES (?, ?)",
                [f"{tx}-{i}", ts],
            )
            con.execute("INSERT INTO warning_codes VALUES (?, '$SPK')", [f"{tx}-{i}"])
    spikes = [c for c in run_alerts(con, cfg(), now=NOW) if c.rule == "warning_spike"]
    assert [c.dedup_key for c in spikes] == ["warning_spike:$SPK:2026-10-10"]
    assert "40 events" in spikes[0].detail


def test_config_validation(tmp_path):
    bad = tmp_path / "alerts.yaml"
    bad.write_text("rules:\n  new_dtc: {severty: warning}\n")
    with pytest.raises(ValueError, match="alerts.yaml"):
        load_config(bad)
    assert load_config(tmp_path / "missing.yaml").lookback_days == 30
    shipped = Path(__file__).parents[2] / "config" / "alerts.yaml"
    assert load_config(shipped).rules.burglar_alarm.severity == "critical"


def test_evaluate_opens_its_own_connection(data_dir, tmp_path):
    db = tmp_path / "e.duckdb"
    ingest(data_dir, db, tmp_path / "codes")
    (tmp_path / "alerts.yaml").write_text("lookback_days: 400\n")
    created, open_count = evaluate(db, tmp_path / "alerts.yaml")
    assert created and open_count == len(created)


def test_notification_summary_and_filtering(monkeypatch):
    low = Candidate("r", "k1", "info", "Minor thing", "", None)
    high = Candidate("r", "k2", "critical", "Alarm!", "", None)
    assert summary([low, high]) == ("CX-5: 2 new alerts", "Alarm! (+1 more)")
    calls = []
    monkeypatch.setattr("platform.system", lambda: "Darwin")
    monkeypatch.setattr(
        "subprocess.run",
        lambda *a, **k: calls.append(a[0]) or type("R", (), {"returncode": 0})(),
    )
    assert (
        notify_desktop([low], AlertsConfig()) is False
    )  # below min_severity (warning)
    assert notify_desktop([low, high], AlertsConfig()) is True
    assert "Alarm!" in calls[0][2] and "Minor thing" not in calls[0][2]
