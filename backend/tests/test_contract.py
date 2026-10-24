"""The golden-response recorder must exercise every API route, or the phone app could drift unnoticed."""

import json
import re

import pytest
from fastapi.routing import APIRoute

from mazda_dash.api.app import app
from mazda_dash.contract import generate


@pytest.fixture(scope="module")
def golden(tmp_path_factory):
    out = tmp_path_factory.mktemp("contract")
    generate(out)
    return out, json.loads((out / "golden.json").read_text())


def test_every_api_route_has_a_successful_golden_case(golden):
    _, cases = golden
    routes = [
        r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/")
    ]
    assert len(routes) >= 27
    for route in routes:
        if (
            route.path == "/api/health"
        ):  # reports the server's database path; the phone has its own answer
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
