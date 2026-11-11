"""The car models the dashboard knows (CX-5, CX-60, ...) and where each model's files live.

``config/models.yaml`` lists the model ids in display order; ``config/models/<id>/model.yaml`` describes
one model. A model owns a folder of raw exports (``data/<id>/``), a database (``db/<id>.duckdb``) and its
configuration (``config/models/<id>/``: ``settings.yaml``, ``alerts.yaml``, ``codes/*.yaml``). Nothing is
shared between models, least of all the descriptions of codes.

Before this layout existed there was one car: raw files directly in ``data/`` and ``db/mazda.duckdb``.
They are still read, as the model ``cx5``, until ``python -m mazda_dash.models migrate`` moves them.

``MAZDA_DB_PREFIX`` (the demo sets ``demo-``) puts every database at db/<prefix><id>.duckdb and turns the
single-car fallback off, so a demo never touches your own databases.

Usage: python -m mazda_dash.models show | ids [--with-db] | db | data | migrate [--yes]"""

import argparse
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

DEFAULT_ROOT = Path(
    ".."
)  # the repository root, seen from backend/ (where every command runs)
LEGACY_MODEL = (
    "cx5"  # the id the single-car layout (data/*.csv, db/mazda.duckdb) is read as
)
SLUG = re.compile(r"[a-z0-9]+")
# page ids a model may hide (the dashboard's routes)
PAGES = ("overview", "trends", "alerts", "warnings", "faults", "status", "diagnostics")
_KEYS = {"id", "name", "platform", "pages", "default"}


class ModelConfigError(ValueError):
    """A models file is wrong; the message says which one and what to fix."""


@dataclass(frozen=True)
class Model:
    id: str
    name: str
    platform: str | None
    hidden_pages: tuple[str, ...]
    default: bool
    data_dir: Path
    db_path: Path
    config_dir: Path
    legacy: tuple[str, ...] = ()  # what is still in the single-car layout: "data", "db"
    db_prefix: str = ""  # MAZDA_DB_PREFIX: the demo keeps its databases apart from yours (demo-cx5.duckdb)

    @property
    def codes_dir(self) -> Path:
        return self.config_dir / "codes"

    @property
    def settings_path(self) -> Path:
        return self.config_dir / "settings.yaml"

    @property
    def alerts_path(self) -> Path:
        return self.config_dir / "alerts.yaml"

    @property
    def pack_path(self) -> Path:
        return self.db_path.parent / f"{self.db_prefix}{self.id}.cx5pack"


@dataclass(frozen=True)
class Registry:
    root: Path
    models: tuple[Model, ...]

    @property
    def ids(self) -> list[str]:
        return [m.id for m in self.models]

    @property
    def default(self) -> Model:
        return next((m for m in self.models if m.default), self.models[0])

    def get(self, model_id: str) -> Model:
        for m in self.models:
            if m.id == model_id:
                return m
        raise ModelConfigError(
            f"unknown model {model_id!r}; the models are: {', '.join(self.ids)}"
        )


def _read(path: Path) -> dict:
    try:
        data = yaml.safe_load(path.read_text())
    except FileNotFoundError:
        raise ModelConfigError(f"{path} not found") from None
    except yaml.YAMLError as e:
        raise ModelConfigError(f"{path} is not valid YAML: {e}") from e
    if not isinstance(data, dict):
        raise ModelConfigError(f"{path} must contain a mapping")
    return data


def _has_files(folder: Path) -> bool:
    return folder.is_dir() and any(
        p.is_file() and not p.name.startswith(".") for p in folder.iterdir()
    )


def _load_model(root: Path, model_id: str) -> Model:
    config_dir = root / "config" / "models" / model_id
    path = config_dir / "model.yaml"
    data = _read(path)
    unknown = set(data) - _KEYS
    if unknown:
        raise ModelConfigError(f"{path}: unknown key(s) {', '.join(sorted(unknown))}")
    if data.get("id") != model_id:
        raise ModelConfigError(
            f"{path}: id is {data.get('id')!r} but the folder is {model_id!r}"
        )
    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ModelConfigError(f"{path}: name is required (for example 'Mazda CX-5')")
    platform = data.get("platform")
    if platform is not None and not isinstance(platform, str):
        raise ModelConfigError(f"{path}: platform must be text")
    pages = data.get("pages", [])
    if not isinstance(pages, list) or any(p not in PAGES for p in pages):
        raise ModelConfigError(f"{path}: pages must be a list of {', '.join(PAGES)}")
    if "overview" in pages:
        raise ModelConfigError(f"{path}: the overview page cannot be hidden")
    default = data.get("default", False)
    if not isinstance(default, bool):
        raise ModelConfigError(f"{path}: default must be true or false")

    prefix = os.environ.get("MAZDA_DB_PREFIX", "")
    data_dir, db_path, legacy = (
        root / "data" / model_id,
        root / "db" / f"{prefix}{model_id}.duckdb",
        [],
    )
    if model_id == LEGACY_MODEL and not prefix:
        if not _has_files(data_dir) and _has_files(root / "data"):
            data_dir = root / "data"
            legacy.append("data")
        if not db_path.exists() and (root / "db" / "mazda.duckdb").exists():
            db_path = root / "db" / "mazda.duckdb"
            legacy.append("db")
    return Model(
        id=model_id,
        name=name.strip(),
        platform=platform,
        hidden_pages=tuple(pages),
        default=default,
        data_dir=data_dir,
        db_path=db_path,
        config_dir=config_dir,
        legacy=tuple(legacy),
        db_prefix=prefix,
    )


def load_registry(root: Path = DEFAULT_ROOT) -> Registry:
    """Read and validate ``config/models.yaml`` and every model it lists."""
    path = root / "config" / "models.yaml"
    data = _read(path)
    if set(data) != {"models"}:
        raise ModelConfigError(
            f"{path}: expected a single key, 'models' (a list of ids)"
        )
    ids = data["models"]
    if not isinstance(ids, list) or not ids:
        raise ModelConfigError(f"{path}: models must be a non-empty list of ids")
    for i in ids:
        if not isinstance(i, str) or not SLUG.fullmatch(i):
            raise ModelConfigError(
                f"{path}: {i!r} is not a model id (lower case letters and digits, for example cx60)"
            )
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise ModelConfigError(f"{path}: listed twice: {', '.join(dupes)}")
    models = tuple(_load_model(root, i) for i in ids)
    if sum(m.default for m in models) > 1:
        raise ModelConfigError(f"{path}: more than one model has default: true")
    return Registry(root, models)


def resolve(model_id: str | None, root: Path = DEFAULT_ROOT) -> Model:
    """The named model, or the default one when no id is given."""
    registry = load_registry(root)
    return registry.get(model_id) if model_id else registry.default


def add_model_option(ap: argparse.ArgumentParser) -> None:
    ap.add_argument(
        "--model",
        help="model id from config/models.yaml (default: the default model); sets the default "
        "paths, which the other options still override",
    )
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT, help=argparse.SUPPRESS)


# ---- moving a single-car install into the model layout ----


def plan_migration(root: Path, model: Model) -> list[tuple[Path, Path]]:
    """Moves that take the single-car layout into ``model``'s folders (empty when there is nothing).
    Raises when a destination already exists: nothing is ever overwritten."""
    registry_dirs = {m.id for m in load_registry(root).models}
    moves: list[tuple[Path, Path]] = []
    data = root / "data"
    target = root / "data" / model.id
    if data.is_dir():
        moves += [
            (p, target / p.name)
            for p in sorted(data.iterdir())
            if not p.name.startswith(".")
            and not (p.is_dir() and p.name in registry_dirs)
        ]
    db = root / "db"
    for old, new in (
        ("mazda.duckdb", f"{model.id}.duckdb"),
        ("mazda.duckdb.wal", f"{model.id}.duckdb.wal"),
        ("mazda.cx5pack", f"{model.id}.cx5pack"),
    ):
        if (db / old).exists():
            moves.append((db / old, db / new))
    clashes = [str(dst) for _, dst in moves if dst.exists()]
    if clashes:
        raise ModelConfigError(
            "refusing to overwrite, these already exist: " + ", ".join(clashes)
        )
    return moves


def migrate(root: Path, model: Model, moves: list[tuple[Path, Path]]) -> None:
    for src, dst in moves:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))


# ---- command line ----


def _one(args: argparse.Namespace) -> Model:
    registry = load_registry(args.root)
    if args.model:
        return registry.get(args.model)
    if len(registry.models) > 1:
        raise ModelConfigError(
            f"there are several models ({', '.join(registry.ids)}): say which one with MODEL=<id>"
        )
    return registry.default


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("command", choices=["show", "ids", "db", "data", "migrate"])
    ap.add_argument("--yes", action="store_true", help="migrate without asking")
    ap.add_argument(
        "--with-db",
        action="store_true",
        help="ids: only the models that have a database",
    )
    add_model_option(ap)
    args = ap.parse_args(argv)
    try:
        registry = load_registry(args.root)
        if args.command == "ids":
            print(
                " ".join(
                    mm.id
                    for mm in registry.models
                    if mm.db_path.exists() or not args.with_db
                )
            )
        elif args.command == "show":
            for m in registry.models:
                star = " (default)" if m is registry.default else ""
                print(f"{m.id}: {m.name}{star}")
                print(f"    data    {m.data_dir}")
                print(f"    db      {m.db_path}")
                print(f"    config  {m.config_dir}")
                if m.legacy:
                    print(
                        f"    note    still the single-car layout for: {', '.join(m.legacy)};"
                        " `make migrate-models` moves it"
                    )
        elif args.command == "db":
            print(_one(args).db_path)
        elif args.command == "data":
            print(_one(args).data_dir)
        else:
            model = registry.get(args.model or LEGACY_MODEL)
            moves = plan_migration(args.root, model)
            if not moves:
                print("Nothing to move: no single-car files found.")
                return 0
            print(f"Moves into the model {model.id!r} ({model.name}):")
            for src, dst in moves:
                print(f"  {src}  ->  {dst}")
            if not args.yes and input("Move these? [y/N] ").strip().lower() != "y":
                print("Nothing was moved.")
                return 1
            migrate(args.root, model, moves)
            print("Done.")
    except ModelConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
