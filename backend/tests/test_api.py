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
