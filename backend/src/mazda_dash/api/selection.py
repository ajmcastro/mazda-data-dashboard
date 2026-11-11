"""Which car model a request is about: the optional ``model`` query parameter of every route.

Without it the default model answers (see ``config/models.yaml``). An unknown id is a 404 that lists the
valid ones. ``MAZDA_ROOT`` points at another repository root (tests); ``MAZDA_DB`` replaces the database of
the default model only (tests and the demo), so another model never answers from it."""

import os
from pathlib import Path
from typing import Annotated

from fastapi import HTTPException, Query

from ..models import DEFAULT_ROOT, Model, ModelConfigError, Registry, load_registry


def registry() -> Registry:
    root = Path(os.environ.get("MAZDA_ROOT", DEFAULT_ROOT))
    try:
        return load_registry(root)
    except ModelConfigError as e:
        raise HTTPException(503, f"The models are not configured correctly: {e}") from e


def get_model(
    model: Annotated[
        str | None,
        Query(description="Model id from /api/models; the default model when omitted"),
    ] = None,
) -> Model:
    reg = registry()
    if model is None:
        return reg.default
    try:
        return reg.get(model)
    except ModelConfigError:
        raise HTTPException(
            404, f"Unknown model {model!r}; the models are: {', '.join(reg.ids)}"
        ) from None


def database_of(model: Model) -> Path:
    """The model's database; ``MAZDA_DB`` stands in for the default model's."""
    if "MAZDA_DB" in os.environ and model.id == registry().default.id:
        return Path(os.environ["MAZDA_DB"])
    return model.db_path
