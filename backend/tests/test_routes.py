"""The route table and the map rendered from it.

These are the tests that make the indirection safe. Generating QF's JSON from a
Python table buys checkability, and this is where that is collected.
"""

from __future__ import annotations

import pytest

from src.api import endpoint_map
from src.api.routes import NAMESPACES, ROUTES, Route
from src.config import Config


def test_every_route_is_mounted(app):
    """The table and the URL map agree, in both directions."""
    mounted = {str(rule) for rule in app.url_map.iter_rules()}
    for route in ROUTES:
        assert f"{Config.API_PREFIX}{route.url}" in mounted, route.operation


def test_operations_are_unique():
    operations = [route.operation for route in ROUTES]
    assert len(operations) == len(set(operations))


def test_handlers_all_import():
    endpoint_map.verify_handlers()


def test_map_matches_the_table():
    document = endpoint_map.build_map()
    assert len(document["endpoints"]) == len(ROUTES)
    assert {ns["name"] for ns in document["namespaces"]} <= set(NAMESPACES)
    for entry, route in zip(document["endpoints"], ROUTES, strict=True):
        assert entry["operation_name"] == route.operation
        assert entry["api_url"] == route.path
        assert entry["exec_method"]["module_name"] == route.module
        assert entry["exec_method"]["method_name"] == route.function


def test_path_repeating_its_namespace_is_rejected():
    """QF strips a leading `/{namespace}` from `api_url`.

    A path that repeats its namespace would be silently truncated — `/health`
    under namespace `health` becomes `/`. The renderer must refuse it rather
    than mount something nobody declared.
    """
    bad = Route(
        namespace="health",
        operation="whoops",
        path="/health/live",
        handler="src.api.health:liveness",
    )
    with pytest.raises(ValueError, match="must not repeat its namespace"):
        endpoint_map.build_map((bad,))


def test_duplicate_operations_are_rejected():
    duplicate = tuple(ROUTES[:1]) * 2
    with pytest.raises(ValueError, match="duplicate operation"):
        endpoint_map.build_map(duplicate)


def test_undeclared_namespace_is_rejected():
    bad = Route(
        namespace="nowhere",
        operation="whoops",
        path="/x",
        handler="src.api.health:liveness",
    )
    with pytest.raises(ValueError, match="undeclared"):
        endpoint_map.build_map((bad,))


def test_written_map_is_valid_json(tmp_path):
    import json

    target = endpoint_map.write_endpoint_map(tmp_path / "endpoint.json")
    document = json.loads(target.read_text())
    assert document["endpoints"] and document["namespaces"]


def test_swagger_document_covers_every_route(client):
    spec = client.get(f"{Config.API_PREFIX}/swagger.json").get_json()
    assert spec["basePath"] == Config.API_PREFIX
    documented = set(spec["paths"])
    for route in ROUTES:
        assert route.url in documented, route.operation
