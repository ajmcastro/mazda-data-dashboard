"""The "How to add a model" guide of the README, followed step by step on a throw-away third model."""

import dataclasses
import shutil
import sys
from pathlib import Path

import duckdb
from fastapi.testclient import TestClient

from mazda_dash import compat, ingest, models, pack, timezone_check
from mazda_dash.api.app import app
from mazda_dash.sample import CX60, generate

REPO = Path(__file__).parents[2]


def run(module, monkeypatch, *args):
    """Run a command line tool's main() like `uv run python -m ... <args>` does."""
    monkeypatch.setattr(sys, "argv", ["tool", *args])
    try:
        result = module.main()
    except SystemExit as stop:  # some tools end with sys.exit(status)
        return stop.code
    return 0 if result is None else result


def test_following_the_guide_adds_a_working_model(tmp_path, monkeypatch, capsys):
    root = tmp_path
    shutil.copytree(REPO / "config", root / "config")
    root_arg = ("--root", str(root))

    # step 1: a folder for the model's configuration (copied from another model), and the id in models.yaml
    shutil.copytree(
        root / "config" / "models" / "cx60", root / "config" / "models" / "mx30"
    )
    (root / "config" / "models" / "mx30" / "model.yaml").write_text(
        "id: mx30\nname: Mazda MX-30\n"
    )
    listed = (root / "config" / "models.yaml").read_text()
    (root / "config" / "models.yaml").write_text(listed.rstrip() + "\n  - mx30\n")
    assert run(models, monkeypatch, "ids", *root_arg) == 0
    assert capsys.readouterr().out.split() == ["cx5", "cx60", "mx30"]

    # step 2: the exports go into data/<id>/ (here: synthetic ones with another platform code and VIN)
    other = dataclasses.replace(
        CX60, id="mx30", platform="mx30x", vin="SAMPLEVIN00000003", seed=5
    )
    generate(root / "data" / "mx30", profile=other)

    # step 3: make ingest MODEL=mx30
    assert run(ingest, monkeypatch, "--model", "mx30", *root_arg) == 0
    out = capsys.readouterr().out
    assert (
        "database:" in out
        and "mx30.duckdb" in out
        and "warning" not in out.lower().split("database:")[0]
    )
    db = root / "db" / "mx30.duckdb"
    assert (
        db.exists() and not (root / "db" / "cx5.duckdb").exists()
    )  # only this model was loaded

    # step 4: make compat / timezone / unmapped
    assert run(compat, monkeypatch, "--model", "mx30", *root_arg) == 0
    assert "the views read" in capsys.readouterr().out
    assert run(timezone_check, monkeypatch, "--model", "mx30", *root_arg) == 0
    assert "fits" in capsys.readouterr().out
    con = duckdb.connect(str(db), read_only=True)
    assert (
        con.execute("SELECT count(*) FROM v_unmapped_codes").fetchone()[0] > 0
    )  # codes to describe
    con.close()

    # step 5: the model shows up in the API (and so in the dashboard's selector), and has a phone pack
    monkeypatch.setenv("MAZDA_ROOT", str(root))
    monkeypatch.delenv("MAZDA_DB", raising=False)
    client = TestClient(app)
    listed_models = {m["id"]: m for m in client.get("/api/models").json()}
    assert (
        listed_models["mx30"]["has_data"]
        and listed_models["mx30"]["name"] == "Mazda MX-30"
    )
    assert not listed_models["cx60"][
        "has_data"
    ]  # nothing loaded for it in this scratch folder
    assert client.get("/api/overview", params={"model": "mx30"}).status_code == 200
    assert run(pack, monkeypatch, "--model", "mx30", *root_arg) == 0
    assert (root / "db" / "mx30.cx5pack").exists()


def test_a_mistake_in_the_guide_steps_is_reported_clearly(
    tmp_path, monkeypatch, capsys
):
    """Forgetting a step gives a message that says what to do, not a stack trace."""
    shutil.copytree(REPO / "config", tmp_path / "config")
    listed = (tmp_path / "config" / "models.yaml").read_text()
    (tmp_path / "config" / "models.yaml").write_text(
        listed.rstrip() + "\n  - mx30\n"
    )  # no folder for it
    assert run(models, monkeypatch, "ids", "--root", str(tmp_path)) == 2
    err = capsys.readouterr().err
    assert "mx30" in err and "model.yaml not found" in err
