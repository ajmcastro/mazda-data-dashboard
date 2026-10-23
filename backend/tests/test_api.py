import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest


@pytest.fixture
def client(data_dir, tmp_path, monkeypatch):
    config = tmp_path / "codes"
    config.mkdir()
    (config / "warnings.yaml").write_text(
        '"$182": {title: Test warning, severity: warning}\n'
    )
    db = tmp_path / "api.duckdb"
    ingest(data_dir, db, config)
    monkeypatch.setenv("MAZDA_DB", str(db))
    return TestClient(app)


def test_health(client):
    assert client.get("/api/health").json()["has_data"] is True


def test_missing_database_is_a_clear_503(tmp_path, monkeypatch):
    monkeypatch.setenv("MAZDA_DB", str(tmp_path / "nope.duckdb"))
    r = TestClient(app).get("/api/overview")
    assert r.status_code == 503
    assert "make ingest" in r.json()["detail"]


def test_overview(client):
    o = client.get("/api/overview").json()
    assert o["vin"] == "TESTVIN0000000001"
    assert o["warnings_total"] == 2
    assert o["active_faults"] == 1
    assert o["last_alarm"]["burglar_status"] == 5
    assert o["odometer_at"].endswith("Z")  # timestamps are explicit UTC
    assert o["unmapped_codes"] > 0


def test_warning_endpoints(client):
    freq = {w["code"]: w for w in client.get("/api/warnings/frequency").json()}
    assert freq["$182"]["title"] == "Test warning" and freq["$182"]["known"] is True
    assert freq["$21D"]["known"] is False
    page = client.get(
        "/api/warnings/events", params={"code": "$210", "limit": 1}
    ).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    assert client.get("/api/warnings/events", params={"limit": 0}).status_code == 422


def test_dtc_endpoints(client):
    events = client.get("/api/dtcs/events", params={"ecu": "ADU"}).json()
    assert [e["dtc_code"] for e in events] == ["C1681"]
    assert events[0]["confirmed"] is True
    assert client.get("/api/dtcs/events", params={"ecu": "BCM"}).json() == []
    snaps = client.get(
        "/api/dtcs/snapshots", params={"ecu": "ADU", "dtc_code": "C1A0F"}
    ).json()
    assert snaps[0]["signal"] == "Vehicle_Speed"
    assert client.get("/api/dtcs/snapshots").status_code == 422  # required params


def test_timelines(client):
    assert len(client.get("/api/status/timeline").json()) == 1
    assert client.get("/api/alarms").json()[0]["burglar_status"] == 5
    assert client.get("/api/odometer/daily").json()
    assert client.get("/api/fuel/monthly").json() == []  # fixture has no trip data


def test_alerts_listing_and_acknowledging(client, tmp_path):
    from mazda_dash.alerts import evaluate

    assert client.get("/api/alerts").json() == []  # nothing evaluated yet
    assert client.get("/api/overview").json()["alerts_new"] == 0

    import os

    cfg = tmp_path / "alerts.yaml"
    cfg.write_text("lookback_days: 400\n")
    evaluate(os.environ["MAZDA_DB"], cfg)

    new = client.get("/api/alerts").json()
    assert new and new[0]["severity"] == "critical"  # worst first
    assert client.get("/api/overview").json()["alerts_new"] == len(new)

    one = client.post(f"/api/alerts/{new[0]['alert_id']}/acknowledge").json()
    assert one["status"] == "acknowledged" and one["acknowledged_at"].endswith("Z")
    assert len(client.get("/api/alerts").json()) == len(new) - 1
    assert len(client.get("/api/alerts", params={"status": "all"}).json()) == len(new)

    assert client.post("/api/alerts/acknowledge-all").json() == {
        "acknowledged": len(new) - 1
    }
    assert client.get("/api/alerts").json() == []
    assert client.post("/api/alerts/999999/acknowledge").status_code == 404
    assert client.get("/api/alerts", params={"status": "bogus"}).status_code == 422


def test_diagnostic_report_endpoints(client):
    reports = client.get("/api/diag/reports").json()
    assert len(reports) == 1 and reports[0]["vin"] == "TESTVIN0000000001"
    rid = reports[0]["report_id"]

    report = client.get(f"/api/diag/reports/{rid}").json()
    names = [s["name"] for s in report["sections"]]
    assert names[:2] == ["identification", "IPT"]  # file order is kept
    assert "AES ID and Status" not in names  # shown separately as id/state pairs
    assert [a["aes_id"] for a in report["aes"]] == ["1814", "181A"]
    assert {(g["list_name"], g["ecu"]) for g in report["dtc_lists"]} == {
        ("dtcs", "ADU"),
        ("rob_dtcs", "DCM"),
    }
    assert [o["in_range"] for o in report["obd_tests"]] == [True, True]
    assert report["obd_tests"][0]["position"] == pytest.approx(
        0.0
    )  # A2/B: value 1 of 0..65535

    frames = client.get(f"/api/diag/reports/{rid}/frames").json()
    assert frames[0]["dtc_code"] == "C1C83" and frames[0]["signals"][0]["unit"] == "%"

    deltas = client.get("/api/diag/compare", params={"a": rid, "b": rid}).json()
    assert deltas and all(d["delta"] == 0 for d in deltas)
    assert client.get("/api/diag/reports/nope").status_code == 404
    assert (
        client.get("/api/diag/compare", params={"a": rid, "b": "nope"}).status_code
        == 404
    )


def test_freeze_frames_and_fault_context(client):
    frames = client.get(
        "/api/dtcs/frames", params={"ecu": "ADU", "dtc_code": "C1A0F"}
    ).json()
    assert len(frames) == 1
    assert frames[0]["snapshot_at"].startswith("2026-06-09T14:34:17")
    assert frames[0]["signals"] == [
        {"signal": "Vehicle_Speed", "value": "12.5", "value_num": 12.5}
    ]
    assert (
        client.get("/api/dtcs/frames", params={"ecu": "ADU", "dtc_code": "NOPE"}).json()
        == []
    )

    ctx = client.get("/api/dtcs/context", params={"transaction_id": "tx-d1"}).json()
    # tx-w1 (same instant: 3 codes) and tx-w2 (38 min later, within the 2 h window)
    assert sorted(w["code"] for w in ctx["warnings"]) == [
        "$182",
        "$210",
        "$210",
        "$21D",
    ]
    assert [f["dtc_code"] for f in ctx["other_faults"]] == ["C1681"]
    assert (
        ctx["status"] is None
    )  # nearest status snapshot is ~10 h away, beyond the 3 h limit
    assert (
        client.get("/api/dtcs/context", params={"transaction_id": "nope"}).status_code
        == 404
    )
