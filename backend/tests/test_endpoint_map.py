"""`maps/endpoint.json` is the API surface, so this is where it gets checked.

QF mounts whatever the map says and resolves handlers lazily inside requests.
That makes several mistakes silent — a duplicate operation name, a handler that
no longer exists, a path that repeats its namespace — so each one is asserted
against here rather than discovered in production.
"""

from __future__ import annotations

import json
import re

import pytest

from src.api import endpoint_map
from src.config import Config


def test_the_committed_map_is_valid():
    endpoint_map.verify()


def test_namespace_matches_the_api_prefix():
    """QF mounts a namespace at `/{name}`; nothing else ties it to the prefix."""
    endpoint_map.check_prefix(Config.API_PREFIX)
    assert Config.API_PREFIX.strip("/") in {ns["name"] for ns in endpoint_map.namespaces()}


def test_every_endpoint_is_mounted(app):
    mounted = {str(rule) for rule in app.url_map.iter_rules()}
    for route in endpoint_map.routes():
        assert route["url"] in mounted, route["operation"]


def test_every_endpoint_is_documented(client):
    """The map, the URL map and the Swagger document describe one API."""
    spec = client.get("/swagger.json").get_json()
    documented = set(spec["paths"])
    for route in endpoint_map.routes():
        # The Api carries no prefix of its own, so a Swagger path is the whole
        # URL — namespace segment included. Flask spells typed path parameters
        # as `<uuid:id>` while OpenAPI spells every parameter as `{id}`.
        expected = re.sub(r"<(?:[^:>]+:)?([^>]+)>", r"{\1}", route["url"])
        assert expected in documented, route["operation"]


def test_routes_expose_their_handler():
    for route in endpoint_map.routes():
        module, _, function = route["handler"].partition(":")
        assert module.startswith("src.api.")
        assert function


def _write(tmp_path, document):
    target = tmp_path / "endpoint.json"
    target.write_text(json.dumps(document))
    return target


def _base(**overrides):
    endpoint = {
        "namespace": "platform",
        "operation_name": "probe",
        "model_name": "Empty",
        "request_method": ["GET"],
        "api_url": "/probe",
        "exec_method": {"module_name": "src.api.health", "method_name": "liveness"},
    }
    endpoint.update(overrides)
    return {
        "namespaces": [{"name": "platform", "description": "test"}],
        "models": {"Empty": {}},
        "endpoints": [endpoint],
    }


def test_missing_map_is_a_clear_failure(tmp_path):
    with pytest.raises(FileNotFoundError, match="endpoint map not found"):
        endpoint_map.load(tmp_path / "absent.json")


def test_unknown_handler_is_rejected(tmp_path):
    bad = _base(exec_method={"module_name": "src.api.health", "method_name": "nope"})
    with pytest.raises(ImportError, match="no callable"):
        endpoint_map.verify(_write(tmp_path, bad))


def test_unknown_module_is_rejected(tmp_path):
    bad = _base(exec_method={"module_name": "src.api.nowhere", "method_name": "x"})
    with pytest.raises(ModuleNotFoundError):
        endpoint_map.verify(_write(tmp_path, bad))


def test_duplicate_operation_is_rejected(tmp_path):
    document = _base()
    document["endpoints"].append(dict(document["endpoints"][0], api_url="/other"))
    with pytest.raises(ValueError, match="duplicate operation_name"):
        endpoint_map.verify(_write(tmp_path, document))


def test_path_repeating_its_namespace_is_rejected(tmp_path):
    """QF strips a leading `/{namespace}`, so `/platform/x` would mount at `/x`."""
    bad = _base(api_url="/platform/health")
    with pytest.raises(ValueError, match="must not repeat its namespace"):
        endpoint_map.verify(_write(tmp_path, bad))


def test_undeclared_namespace_is_rejected(tmp_path):
    bad = _base(namespace="nowhere")
    with pytest.raises(ValueError, match="not declared"):
        endpoint_map.verify(_write(tmp_path, bad))


def test_undeclared_model_is_rejected(tmp_path):
    bad = _base(model_name="Nope")
    with pytest.raises(ValueError, match="model_name"):
        endpoint_map.verify(_write(tmp_path, bad))


def test_relative_api_url_is_rejected(tmp_path):
    bad = _base(api_url="health/live")
    with pytest.raises(ValueError, match="must start with"):
        endpoint_map.verify(_write(tmp_path, bad))


def test_prefix_mismatch_is_rejected(tmp_path):
    document = _base()
    document["namespaces"] = [{"name": "elsewhere", "description": "x"}]
    document["endpoints"][0]["namespace"] = "elsewhere"
    with pytest.raises(ValueError, match="API_PREFIX"):
        endpoint_map.check_prefix("/platform", _write(tmp_path, document))
