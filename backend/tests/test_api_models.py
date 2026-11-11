"""Every API route answers for the model named by ``?model=`` (PLAN.md M23)."""

import pytest
from conftest import ALT, DIAG, DTC_D, DTC_H, DTC_SSR, RTS, VIN, WAR
from fastapi.testclient import TestClient

from mazda_dash.alerts import evaluate
from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.models import load_registry
from mazda_dash.sample import generate

# routes that are about the server, not about one model
NOT_PER_MODEL = {"/api/models"}
# GET routes that need nothing but the model, and differ between the two test models
SAMPLES = [
    "/api/span", "/api/overview", "/api/odometer/daily", "/api/trips/segments",
    "/api/status/timeline", "/api/warnings/frequency", "/api/warnings/events",
    "/api/dtcs/frequency", "/api/dtcs/events", "/api/codes/unmapped", "/api/alerts",
    "/api/maintenance/oil", "/api/diag/reports", "/api/diag/history",
]  # fmt: skip


@pytest.fixture(scope="module")
def two_models(tmp_path_factory):
    """cx5: the synthetic car (four months). cx60: the small test fixtures (one day, other VIN)."""
    root = tmp_path_factory.mktemp("models")
    (root / "config" / "models.yaml").parent.mkdir(parents=True)
    (root / "config" / "models.yaml").write_text("models: [cx5, cx60]\n")
    for i, name in (("cx5", "Mazda CX-5"), ("cx60", "Mazda CX-60")):
        d = root / "config" / "models" / i
        d.mkdir(parents=True)
        (d / "model.yaml").write_text(
            f"id: {i}\nname: {name}\nplatform: P{i}\n"
            + ("pages: [trends]\n" if i == "cx60" else "default: true\n")
        )
    generate(root / "data" / "cx5")
    small = root / "data" / "cx60"
    small.mkdir(parents=True)
    for fname, text in {
        "all-war-60_war-60.csv": WAR,
        "all-dtc-h-60_dtc-h-60.csv": DTC_H,
        "all-dtc-d-60_dtc-d-60.csv": DTC_D,
        "all-dtc-ssr-60_dtc-ssr-60.csv": DTC_SSR,
        "all-rts-60_rts-60.csv": RTS,
        "all-alt-60_alt-60.csv": ALT,
        "all-60-diag-tool_60-diag-tool_1_20261015_090243.txt": DIAG,
    }.items():
        (small / fname).write_text(text.replace(VIN, "TESTVIN0000000002"))
    for m in load_registry(root).models:
        ingest(m.data_dir, m.db_path, m.codes_dir)
        evaluate(m.db_path, m.alerts_path)
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_ROOT", str(root))
    mp.delenv("MAZDA_DB", raising=False)
    yield root
    mp.undo()


@pytest.fixture
def client(two_models):
    return TestClient(app)


def get(client, path, model=None, **params):
    if model:
        params["model"] = model
    r = client.get(path, params=params)
    assert r.status_code == 200, f"{path} {params}: {r.text}"
    return r.json()


def test_every_route_declares_the_model_parameter():
    """A route added without the dependency fails here, before it can answer from the wrong model."""
    schema = app.openapi()
    for path, item in schema["paths"].items():
        if path in NOT_PER_MODEL:
            continue
        for method, op in item.items():
            names = {p["name"] for p in op.get("parameters", [])}
            assert "model" in names, f"{method.upper()} {path} has no `model` parameter"


def test_the_model_list(client):
    models = get(client, "/api/models")
    assert [m["id"] for m in models] == ["cx5", "cx60"]
    cx5, cx60 = models
    assert cx5["default"] and not cx60["default"]
    assert cx5["name"] == "Mazda CX-5" and cx60["platform"] == "Pcx60"
    assert cx60["hidden_pages"] == ["trends"] and cx5["hidden_pages"] == []
    assert cx5["has_data"] and cx5["first_day"] == "2026-03-01"
    assert (
        cx60["last_day"] and cx60["last_day"] != cx5["last_day"]
    )  # the small fixture, not the sample car


def test_a_model_without_a_database_is_listed_but_has_no_data(client, two_models):
    db = load_registry(two_models).get("cx60").db_path
    hidden = db.rename(db.with_suffix(".moved"))
    try:
        cx60 = get(client, "/api/models")[1]
        assert cx60["has_data"] is False and cx60["first_day"] is None
        r = client.get("/api/span", params={"model": "cx60"})
        assert r.status_code == 503 and "make ingest MODEL=cx60" in r.json()["detail"]
    finally:
        hidden.rename(db)


@pytest.mark.parametrize("path", SAMPLES)
def test_a_route_answers_for_the_chosen_model(client, path):
    default = get(client, path)
    assert get(client, path, "cx5") == default  # omitted = the default model
    assert get(client, path, "cx60") != default  # and another model answers differently


def test_an_unknown_model_is_a_404_that_lists_the_valid_ones(client):
    r = client.get("/api/overview", params={"model": "cx70"})
    assert r.status_code == 404
    assert "cx70" in r.json()["detail"] and "cx5, cx60" in r.json()["detail"]
    assert client.get("/api/health", params={"model": "cx70"}).status_code == 404


def test_health_reports_the_models_database(client, two_models):
    assert get(client, "/api/health", "cx60")["database"].endswith("cx60.duckdb")
    assert get(client, "/api/health")["database"].endswith("cx5.duckdb")


def test_acknowledging_in_one_model_leaves_the_other(client):
    new_cx5 = get(client, "/api/alerts", "cx5")
    new_cx60 = get(client, "/api/alerts", "cx60")
    assert new_cx5 and new_cx60
    r = client.post("/api/alerts/acknowledge-all", params={"model": "cx60"})
    assert r.status_code == 200 and r.json()["acknowledged"] == len(new_cx60)
    assert get(client, "/api/alerts", "cx60") == []
    assert get(client, "/api/alerts", "cx5") == new_cx5


def test_mazda_db_only_replaces_the_default_models_database(
    client, two_models, monkeypatch
):
    other = two_models / "elsewhere.duckdb"
    monkeypatch.setenv("MAZDA_DB", str(other))
    assert get(client, "/api/health")["database"] == str(other)
    assert get(client, "/api/health", "cx60")["database"].endswith("cx60.duckdb")


def test_broken_model_config_is_a_503_with_the_reason(client, two_models):
    path = two_models / "config" / "models.yaml"
    path.write_text("models: []\n")
    try:
        r = client.get("/api/span")
        assert r.status_code == 503 and "not configured correctly" in r.json()["detail"]
    finally:
        path.write_text("models: [cx5, cx60]\n")
