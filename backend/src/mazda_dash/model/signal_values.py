"""What the values of some signals mean, as Mazda documents them per platform (PLAN.md M72).

``config/platforms/<platform>/signal_values.yaml`` becomes the ``ref_signal_values`` table (signal, value,
label, state) in the database of a model whose platform it is. The model's platform comes from its
``model.yaml``; a settings file may name one only for a model that has none (the sample's settings, so the
demo shows the meanings without the real model being given a platform it has not been checked for). A model
with no platform, or one without a file, gets an empty table and its pages show raw numbers."""

from pathlib import Path

import duckdb
import yaml

FILE = "signal_values.yaml"
STATES = ("ok", "info", "attention", "unknown")
DDL = (
    "CREATE OR REPLACE TABLE ref_signal_values "
    "(signal VARCHAR, value DOUBLE, label VARCHAR, state VARCHAR)"
)


def config_root(codes_dir: Path) -> Path | None:
    """The ``config`` folder above ``config/models/<id>/codes``; None for a codes folder elsewhere (a test's)."""
    model_dir = codes_dir.parent
    if model_dir.parent.name != "models":
        return None
    return model_dir.parent.parent


def model_platform(codes_dir: Path) -> str | None:
    """The ``platform`` of the ``model.yaml`` next to the codes folder (validated by ``models.py``)."""
    path = codes_dir.parent / "model.yaml"
    if not path.exists():
        return None
    data = yaml.safe_load(path.read_text()) or {}
    platform = data.get("platform") if isinstance(data, dict) else None
    return platform if isinstance(platform, str) else None


def read_values(path: Path) -> tuple[str, list[tuple[str, float, str, str]]]:
    """The file's source and its rows, checked (a typo in a state, a missing label or a value that is not a
    whole number fails loudly, naming the file and the signal)."""
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict) or set(data) != {"source", "signals"}:
        raise ValueError(f"{path}: expected exactly `source` and `signals`")
    source = data["source"]
    if not isinstance(source, str) or not source.strip():
        raise ValueError(f"{path}: `source` must say where the meanings come from")
    signals = data["signals"]
    if not isinstance(signals, dict) or not signals:
        raise ValueError(f"{path}: `signals` must map signal names to their values")
    rows = []
    for signal, values in signals.items():
        where = f"{path}: {signal}"
        if not isinstance(signal, str) or not signal.isidentifier():
            raise ValueError(f"{where}: a signal name is one word, as in the exports")
        if not isinstance(values, dict) or not values:
            raise ValueError(
                f"{where}: expected a mapping of value -> {{label, state}}"
            )
        for value, meaning in values.items():
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(  # noqa: TRY004 - every config error is a ValueError that names the file
                    f"{where}: {value!r} is not a whole number"
                )
            if not isinstance(meaning, dict) or set(meaning) != {"label", "state"}:
                raise ValueError(f"{where}: {value}: needs exactly `label` and `state`")
            label, state = meaning["label"], meaning["state"]
            if not isinstance(label, str) or not label.strip() or len(label) > 60:
                raise ValueError(f"{where}: {value}: `label` must be a short text")
            if state not in STATES:
                raise ValueError(
                    f"{where}: {value}: state must be one of {', '.join(STATES)}, not {state!r}"
                )
            rows.append((signal, float(value), label.strip(), state))
    return source.strip(), rows


def platform_of(
    codes_dir: Path, settings: dict[str, str], settings_path: Path | None
) -> str | None:
    """The model's platform, or the one its settings name when the model has none."""
    own = model_platform(codes_dir)
    named = settings.get("platform")
    if own and named:
        raise ValueError(
            f"{settings_path}: `platform` is only for a model whose model.yaml has none "
            f"(this one says {own})"
        )
    return own or named


def load_signal_values(
    con: duckdb.DuckDBPyConnection,
    codes_dir: Path,
    settings: dict[str, str],
    settings_path: Path | None = None,
) -> int:
    """(Re)create ``ref_signal_values`` for the model's platform (always a table, empty without one) and note
    the platform and the source in ``ref_settings``. Returns the number of values."""
    con.execute(DDL)
    con.execute(
        "DELETE FROM ref_settings WHERE key IN ('platform', 'signal_values_source')"
    )
    platform = platform_of(codes_dir, settings, settings_path)
    root = config_root(codes_dir)
    if platform is None or root is None:
        return 0
    path = root / "platforms" / platform / FILE
    if not path.exists():
        return 0
    source, rows = read_values(path)
    con.executemany("INSERT INTO ref_signal_values VALUES (?, ?, ?, ?)", rows)
    con.executemany(
        "INSERT INTO ref_settings VALUES (?, ?)",
        [("platform", platform), ("signal_values_source", source)],
    )
    return len(rows)
