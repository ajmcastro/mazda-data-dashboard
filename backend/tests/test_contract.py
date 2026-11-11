"""The golden-response recorder must exercise every API route, or the phone app could drift unnoticed."""

import json
import re

import pytest
from fastapi.routing import APIRoute

from mazda_dash.api.app import app
from mazda_dash.contract import generate, generate_all, sample_models


@pytest.fixture(scope="module", params=sample_models())
def golden(request, tmp_path_factory):
    """The goldens of each model that has sample data (the phone app replays every one of them)."""
    out = tmp_path_factory.mktemp("contract")
    generate(out, model_id=request.param)
    return out, json.loads((out / "golden.json").read_text())


def test_every_model_with_sample_data_gets_goldens(tmp_path):
    infos = generate_all(tmp_path)
    assert set(infos) == set(sample_models()) and {"cx5", "cx60"} <= set(infos)
    for model in infos:
        assert (tmp_path / model / "golden.json").exists()
        assert (tmp_path / model / "sample.cx5pack").exists()
    (tmp_path / "golden.json").write_text("[]")  # a leftover of the single-model layout
    generate_all(tmp_path)
    assert not (tmp_path / "golden.json").exists()


def test_every_api_route_has_a_successful_golden_case(golden):
    _, cases = golden
    routes = [
        r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/")
    ]
    assert len(routes) >= 27
    for route in routes:
        if (
            route.path
            in (
                "/api/health",  # reports the server's database path; the phone has its own answer
                "/api/models",  # the server's models; the phone lists its stored packs (M26)
            )
        ):
            continue
        pattern = re.compile(
            "^" + re.sub(r"\{\w+\}", "[^/?]+", route.path) + r"(\?.*)?$"
        )
        method = next(iter(route.methods - {"HEAD", "OPTIONS"}))
        ok = [
            c
            for c in cases
            if c["method"] == method and pattern.match(c["url"]) and c["status"] == 200
        ]
        assert ok, f"no successful golden case for {method} {route.path}"


def test_the_matrix_covers_errors_and_every_period_shape(golden):
    _, cases = golden
    statuses = {c["status"] for c in cases}
    assert {200, 404, 405, 422} <= statuses
    overview = {c["url"] for c in cases if c["url"].startswith("/api/overview")}
    assert len(overview) >= 14  # open, half-open, month, single day, empty, invalid ...


def test_the_pack_is_written_next_to_the_goldens(golden):
    out, _ = golden
    assert (out / "sample.cx5pack").stat().st_size > 10_000
