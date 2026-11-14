"""The model registry (config/models*.yaml) and the move from the single-car layout (PLAN.md M21)."""

from pathlib import Path

import pytest

from mazda_dash.audit import collect_tokens
from mazda_dash.models import (
    ModelConfigError,
    load_registry,
    main,
    migrate,
    plan_migration,
    resolve,
)

REPO = Path(__file__).parents[2]


def make_root(tmp_path: Path, ids=("cx5",), **extra) -> Path:
    """A repository skeleton with the given models (extra: model id -> extra model.yaml text)."""
    (tmp_path / "config" / "models").mkdir(parents=True)
    (tmp_path / "config" / "models.yaml").write_text(
        "models:\n" + "".join(f"  - {i}\n" for i in ids)
    )
    for i in ids:
        d = tmp_path / "config" / "models" / i
        d.mkdir()
        (d / "model.yaml").write_text(
            f"id: {i}\nname: Mazda {i.upper()}\n{extra.get(i, '')}"
        )
    return tmp_path


def test_the_shipped_registry_is_valid():
    registry = load_registry(REPO)
    cx5 = registry.get("cx5")
    assert cx5.name == "Mazda CX-5" and cx5.platform == "24PF"
    assert registry.default is cx5
    for path in (cx5.codes_dir, cx5.settings_path, cx5.alerts_path):
        assert path.exists(), path


def test_paths_of_a_model_in_the_new_layout(tmp_path):
    root = make_root(tmp_path, ("cx5", "cx60"))
    (root / "data" / "cx60").mkdir(parents=True)
    (root / "data" / "cx60" / "a.csv").write_text("x")
    cx60 = resolve("cx60", root)
    assert cx60.data_dir == root / "data" / "cx60"
    assert cx60.db_path == root / "db" / "cx60.duckdb"
    assert cx60.pack_path == root / "db" / "cx60.cx5pack"
    assert cx60.config_dir == root / "config" / "models" / "cx60"
    assert cx60.legacy == ()
    assert resolve(None, root).id == "cx5"  # the first one, when none is marked default


def test_default_flag_and_unknown_model(tmp_path):
    root = make_root(tmp_path, ("cx5", "cx60"), cx60="default: true\n")
    assert resolve(None, root).id == "cx60"
    with pytest.raises(ModelConfigError, match="unknown model 'cx70'.*cx5, cx60"):
        resolve("cx70", root)


@pytest.mark.parametrize(
    ("models_yaml", "message"),
    [
        ("models: []\n", "non-empty list"),
        ("models: [CX5]\n", "not a model id"),
        ("models: [cx-5]\n", "not a model id"),
        ("models: [cx5, cx5]\n", "listed twice: cx5"),
        ("other: [cx5]\n", "expected a single key"),
        ("models: [cx5, gone]\n", "gone.*model.yaml not found"),
    ],
)
def test_registry_errors(tmp_path, models_yaml, message):
    root = make_root(tmp_path)
    (root / "config" / "models.yaml").write_text(models_yaml)
    with pytest.raises(ModelConfigError, match=message):
        load_registry(root)


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("id: other\nname: X\n", "id is 'other' but the folder is 'cx5'"),
        ("id: cx5\n", "name is required"),
        ("id: cx5\nname: X\nvolour: red\n", "unknown key.*volour"),
        ("id: cx5\nname: X\npages: [garage]\n", "pages must be a list"),
        ("id: cx5\nname: X\npages: [overview]\n", "overview page cannot be hidden"),
        ("id: cx5\nname: X\ndefault: maybe\n", "default must be true or false"),
        ("id: cx5\nname: X\nplatform: [1]\n", "platform must be text"),
        ("- not a mapping\n", "must contain a mapping"),
        ("id: cx5\nname: X\nbody: 4575\n", "body must be a mapping"),
        (
            "id: cx5\nname: X\nbody: {lenght_mm: 4575}\n",
            "body has unknown key.*lenght_mm",
        ),
        (
            "id: cx5\nname: X\nbody: {length_mm: 4.575}\n",
            "length_mm must be a number of millimetres",
        ),
        ("id: cx5\nname: X\nbody: {width_mm: wide}\n", "width_mm must be a number"),
        ("id: cx5\nname: X\nbody: {height_mm: true}\n", "height_mm must be a number"),
        (
            "id: cx5\nname: X\nbody: {steering: middle}\n",
            "steering must be left or right",
        ),
        (
            "id: cx5\nname: X\nbody: {shape: cx90}\n",
            "shape must be one of generic, cx60, cx5",
        ),
        (
            "id: cx5\nname: X\nbody: {length_mm: 3700, wheelbase_mm: 3800}\n",
            "wheelbase_mm must be less than length_mm",
        ),
    ],
)
def test_model_file_errors(tmp_path, text, message):
    root = make_root(tmp_path)
    (root / "config" / "models" / "cx5" / "model.yaml").write_text(text)
    with pytest.raises(ModelConfigError, match=message):
        load_registry(root)


def test_two_defaults_are_an_error(tmp_path):
    root = make_root(
        tmp_path, ("cx5", "cx60"), cx5="default: true\n", cx60="default: true\n"
    )
    with pytest.raises(ModelConfigError, match="more than one model"):
        load_registry(root)


def test_body_is_optional_and_each_dimension_too(tmp_path):
    """`body:` feeds the 3D drawing of the car (PLAN.md M41)."""
    assert resolve("cx5", make_root(tmp_path / "none")).body is None
    root = make_root(
        tmp_path / "some", cx5="body: {length_mm: 4575, wheelbase_mm: 2700}\n"
    )
    body = resolve("cx5", root).body
    assert body.length_mm == 4575 and body.wheelbase_mm == 2700
    assert body.width_mm is None and body.steering == "left"
    assert body.as_dict() == {
        "length_mm": 4575.0,
        "width_mm": None,
        "height_mm": None,
        "wheelbase_mm": 2700.0,
        "track_mm": None,
        "wheel_diameter_mm": None,
        "steering": "left",
        "shape": "generic",
    }
    shaped = make_root(tmp_path / "shaped", cx5="body: {shape: cx60}\n")
    assert resolve("cx5", shaped).body.shape == "cx60"
    right = make_root(tmp_path / "right", cx5="body: {steering: right}\n")
    assert resolve("cx5", right).body.steering == "right"


def test_the_shipped_models_have_dimensions():
    """The two models in the repository draw as themselves, the CX-60 longer than the CX-5."""
    registry = load_registry(Path(__file__).parents[2])
    cx5, cx60 = registry.get("cx5").body, registry.get("cx60").body
    assert cx5 and cx60 and cx60.length_mm > cx5.length_mm
    assert cx60.wheelbase_mm > cx5.wheelbase_mm
    # each is drawn with its own outline
    assert cx60.shape == "cx60" and cx5.shape == "cx5"


def test_hidden_pages(tmp_path):
    root = make_root(tmp_path, cx5="pages: [trends, diagnostics]\n")
    assert resolve("cx5", root).hidden_pages == ("trends", "diagnostics")


def single_car_install(root: Path) -> None:
    (root / "data" / "archive").mkdir(parents=True)
    (root / "data" / "all-war-24pf_war-24pf.csv").write_text("w")
    (root / "data" / "diag-tool.txt").write_text("d")
    (root / "data" / ".DS_Store").write_text("junk")
    (root / "data" / "archive" / "old.csv").write_text("o")
    (root / "db").mkdir()
    for name in ("mazda.duckdb", "mazda.duckdb.wal", "mazda.cx5pack", "demo.duckdb"):
        (root / "db" / name).write_text(name)


def test_the_single_car_layout_is_still_read_as_cx5(tmp_path):
    root = make_root(tmp_path, ("cx5", "cx60"))
    single_car_install(root)
    cx5, cx60 = resolve("cx5", root), resolve("cx60", root)
    assert cx5.data_dir == root / "data" and cx5.db_path == root / "db" / "mazda.duckdb"
    assert cx5.legacy == ("data", "db")
    # only the model the old layout belonged to falls back; another model never reads cx5's files
    assert cx60.data_dir == root / "data" / "cx60" and cx60.legacy == ()
    assert cx60.db_path == root / "db" / "cx60.duckdb"


def test_the_new_layout_wins_over_the_single_car_files(tmp_path):
    root = make_root(tmp_path)
    single_car_install(root)
    (root / "data" / "cx5").mkdir()
    (root / "data" / "cx5" / "a.csv").write_text("x")
    (root / "db" / "cx5.duckdb").write_text("x")
    cx5 = resolve("cx5", root)
    assert cx5.data_dir == root / "data" / "cx5"
    assert cx5.db_path == root / "db" / "cx5.duckdb"
    assert cx5.legacy == ()


def test_migration_moves_everything_and_nothing_is_lost(tmp_path):
    root = make_root(tmp_path, ("cx5", "cx60"))
    single_car_install(root)
    (root / "data" / "cx60").mkdir()  # another model's folder stays where it is
    (root / "data" / "cx60" / "b.csv").write_text("b")
    cx5 = resolve("cx5", root)
    moves = plan_migration(root, cx5)
    moved = {src.relative_to(root).as_posix() for src, _ in moves}
    assert moved == {
        "data/all-war-24pf_war-24pf.csv",
        "data/diag-tool.txt",
        "data/archive",
        "db/mazda.duckdb",
        "db/mazda.duckdb.wal",
        "db/mazda.cx5pack",
    }
    migrate(root, cx5, moves)
    assert (root / "data" / "cx5" / "all-war-24pf_war-24pf.csv").read_text() == "w"
    assert (root / "data" / "cx5" / "archive" / "old.csv").read_text() == "o"
    assert (root / "db" / "cx5.duckdb").read_text() == "mazda.duckdb"
    assert (root / "db" / "cx5.duckdb.wal").exists() and (
        root / "db" / "cx5.cx5pack"
    ).exists()
    assert (root / "db" / "demo.duckdb").exists()  # not the real database: untouched
    assert (root / "data" / ".DS_Store").exists()
    assert (root / "data" / "cx60" / "b.csv").exists()
    assert not (root / "data" / "diag-tool.txt").exists()
    after = resolve("cx5", root)
    assert after.legacy == () and after.data_dir == root / "data" / "cx5"
    assert plan_migration(root, after) == []  # a second run has nothing to do


def test_migration_never_overwrites(tmp_path):
    root = make_root(tmp_path)
    single_car_install(root)
    (root / "db" / "cx5.duckdb").write_text("already here")
    with pytest.raises(ModelConfigError, match="refusing to overwrite.*cx5.duckdb"):
        plan_migration(root, resolve("cx5", root))
    assert (root / "db" / "mazda.duckdb").exists()


def test_the_command_line(tmp_path, capsys):
    root = make_root(tmp_path, ("cx5", "cx60"))
    base = ["--root", str(root)]
    assert main(["ids", *base]) == 0
    assert capsys.readouterr().out.split() == ["cx5", "cx60"]
    assert main(["db", "--model", "cx60", *base]) == 0
    assert capsys.readouterr().out.strip() == str(root / "db" / "cx60.duckdb")
    # with several models a command that needs one database must be told which
    assert main(["db", *base]) == 2
    assert "MODEL=<id>" in capsys.readouterr().err
    assert main(["db", "--model", "nope", *base]) == 2
    assert main(["show", *base]) == 0


def test_the_command_line_migrates_after_the_plan_is_shown(
    tmp_path, capsys, monkeypatch
):
    root = make_root(tmp_path)
    single_car_install(root)
    base = ["migrate", "--root", str(root)]
    monkeypatch.setattr("builtins.input", lambda _: "n")
    assert main(base) == 1
    assert (root / "db" / "mazda.duckdb").exists()  # declined: nothing moved
    monkeypatch.setattr("builtins.input", lambda _: "y")
    assert main(base) == 0
    assert (root / "db" / "cx5.duckdb").exists()
    assert "Nothing to move" in (main(base), capsys.readouterr().out)[1]


def test_the_audit_reads_every_model_folder(tmp_path):
    folder = tmp_path / "cx60"
    folder.mkdir()
    (folder / "all-rts_rts-x.csv").write_text('"vin","a"\n"REALVIN1234567890","1"\n')
    assert collect_tokens(tmp_path, []) == {"REALVIN1234567890"}


def test_the_demo_prefix_keeps_the_databases_apart(tmp_path, monkeypatch):
    root = make_root(tmp_path, ("cx5", "cx60"))
    single_car_install(root)  # the single-car fallback must not leak into a demo
    monkeypatch.setenv("MAZDA_DB_PREFIX", "demo-")
    cx5 = resolve("cx5", root)
    assert cx5.db_path == root / "db" / "demo-cx5.duckdb" and cx5.legacy == ()
    assert cx5.data_dir == root / "data" / "cx5"
    assert resolve("cx60", root).pack_path == root / "db" / "demo-cx60.cx5pack"


def test_ids_with_a_database_only(tmp_path, capsys):
    root = make_root(tmp_path, ("cx5", "cx60"))
    (root / "db").mkdir()
    (root / "db" / "cx60.duckdb").write_text("x")
    assert main(["ids", "--with-db", "--root", str(root)]) == 0
    assert capsys.readouterr().out.split() == ["cx60"]
