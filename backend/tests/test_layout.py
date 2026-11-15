"""The fault map's placements (PLAN.md M59): layout.yaml, GET /api/models and the pack manifest."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.models import ZONES, ModelConfigError, Unit, load_layout, load_registry
from mazda_dash.pack import model_info


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "layout.yaml"
    path.write_text(text)
    return path


def test_no_file_places_nothing(tmp_path):
    assert load_layout(tmp_path / "layout.yaml") == ()
    assert load_layout(write(tmp_path, "# nothing placed yet\n")) == ()


def test_a_unit_is_placed_in_a_zone_or_at_a_position(tmp_path):
    units = load_layout(
        write(
            tmp_path,
            'units:\n  ECM: {zone: engine bay, source: "workshop manual, page 12"}\n  BCM: {at: [0.3, 0.2, 0.4]}\n',
        )
    )
    assert units == (
        Unit("ECM", "engine bay", None, "workshop manual, page 12"),
        Unit("BCM", None, (0.3, 0.2, 0.4), None),
    )
    assert units[1].as_dict() == {
        "ecu": "BCM",
        "zone": None,
        "at": [0.3, 0.2, 0.4],
        "source": None,
    }
    assert ZONES == ("engine bay", "dashboard", "under front seats", "rear", "roof")


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("ECM: {zone: engine bay}\n", "expected `units:`"),
        ("units: [ECM]\n", "expected `units:`"),
        ("units:\n  ECM: engine bay\n", "may have `zone` or `at`"),
        ("units:\n  ECM: {zone: engine bay, colour: red}\n", "may have `zone` or `at`"),
        ("units:\n  ECM: {source: guess}\n", "needs either `zone` or `at`"),
        (
            "units:\n  ECM: {zone: engine bay, at: [0.1, 0.5, 0.3]}\n",
            "needs either `zone` or `at`",
        ),
        ("units:\n  ECM: {zone: glovebox}\n", "zone must be one of engine bay"),
        ("units:\n  ECM: {at: [0.1, 0.5]}\n", "three fractions between 0 and 1"),
        ("units:\n  ECM: {at: [0.1, 0.5, 1.5]}\n", "three fractions between 0 and 1"),
        ("units:\n  ECM: {at: [front, 0.5, 0.2]}\n", "three fractions between 0 and 1"),
        ("units:\n  ECM: {zone: rear, source: 12}\n", "source must be text"),
    ],
)
def test_a_mistake_fails_loudly_and_names_the_file(tmp_path, text, message):
    path = write(tmp_path, text)
    with pytest.raises(ModelConfigError, match=message) as e:
        load_layout(path)
    assert str(path) in str(e.value)


@pytest.fixture
def root(tmp_path, monkeypatch):
    cfg = tmp_path / "config" / "models" / "cx5"
    cfg.mkdir(parents=True)
    (tmp_path / "config" / "models.yaml").write_text("models: [cx5]\n")
    (cfg / "model.yaml").write_text(
        "id: cx5\nname: Mazda CX-5\nplatform: P\ndefault: true\n"
    )
    monkeypatch.setenv("MAZDA_ROOT", str(tmp_path))
    monkeypatch.delenv("MAZDA_DB", raising=False)
    return tmp_path


def test_the_models_route_and_the_pack_carry_the_placements(root):
    client = TestClient(app)
    assert (
        client.get("/api/models").json()[0]["layout"] == []
    )  # nothing placed: nothing guessed
    (root / "config" / "models" / "cx5" / "layout.yaml").write_text(
        "units:\n  BCM: {zone: dashboard, source: dealer}\n"
    )
    placed = [{"ecu": "BCM", "zone": "dashboard", "at": None, "source": "dealer"}]
    assert client.get("/api/models").json()[0]["layout"] == placed
    model = load_registry(root).get("cx5")
    assert model_info(model)["layout"] == placed
    assert (
        model_info(None).get("layout") is None
    )  # a pack made without a registry: none, as before


def test_a_broken_file_stops_the_model_from_loading(root):
    (root / "config" / "models" / "cx5" / "layout.yaml").write_text(
        "units:\n  BCM: {zone: boot}\n"
    )
    r = TestClient(app).get("/api/models")
    assert r.status_code == 503 and "zone must be one of" in r.json()["detail"]


def test_the_repository_places_nothing_for_the_owner():
    """Placements are the owner's knowledge: the project ships none, so no unit is ever drawn by a guess."""
    repo = Path(__file__).parents[2]
    for model in load_registry(repo).models:
        path = model.config_dir / "layout.yaml"
        assert not path.exists() or all(u.source for u in load_layout(path)), path
