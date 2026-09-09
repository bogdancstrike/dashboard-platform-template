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


#: The endpoints an anonymous caller may reach, and why each one has to be.
#:
#: A list somebody has to add to on purpose. Authentication on 154 endpoints is
#: 154 decorators, and a route that forgets one is not visibly different from a
#: route that has one — it answers, with data, to nobody in particular. The
#: sweep below is what turns that from a review question into a failing test
#: (§76).
PUBLIC: dict[str, str] = {
    "/platform/health/live": "a liveness probe an orchestrator calls with no credential",
    "/platform/health/ready": "a readiness probe, same",
    "/platform/health/status": "the dependency summary the compose stack waits on",
    "/platform/meta/app": (
        "the OIDC coordinates the SPA needs to *start* a login, which it cannot "
        "have obtained by logging in"
    ),
    "/platform/api/files/blob": (
        "a signed link's own credential is its signature — a browser following "
        "an <img>, an <iframe> or a download cannot add a bearer header, which "
        "is the whole reason presigned URLs exist. Only the local store issues "
        "these, and `files.blob` refuses when object storage is configured"
    ),
}


def _concrete(url: str) -> str:
    """One mounted path with its parameters filled in.

    The value only has to be *shaped* right: every endpoint under test refuses
    the request before it looks at a parameter, and one that did not would be
    the finding.
    """
    url = re.sub(r"<uuid:[^>]+>", "11111111-1111-1111-1111-111111111111", url)
    return re.sub(r"<(?:[^:>]+:)?[^>]+>", "probe", url)


def test_every_endpoint_refuses_an_anonymous_request(client):
    """The security property no per-endpoint test suite can promise.

    Each endpoint's own test asserts its 401 — when somebody wrote one. This
    asserts it for *all* of them, from the map, so an endpoint added tomorrow
    is covered by being in the map rather than by being remembered.
    """
    leaked = []
    for route in endpoint_map.routes():
        if route["url"] in PUBLIC:
            continue
        url = _concrete(route["url"])
        for method in route["methods"]:
            response = client.open(url, method=method)
            # 401 for "no token". A 404 or 405 would mean this sweep is not
            # reaching the handler and is therefore proving nothing.
            if response.status_code != 401:
                leaked.append(f"{method} {url} → {response.status_code}")
    assert leaked == []


def test_a_signed_link_is_the_credential_and_an_unsigned_one_is_not(
    client, tmp_path, monkeypatch
):
    """The one public endpoint that serves *data* rather than metadata.

    Its exemption is only honest if the signature is actually checked — an
    endpoint on the public list that reads a query parameter and hands back
    bytes would be an open object store. So: a valid link works, a tampered
    one does not, an expired one does not, and a missing one does not.
    """
    import time

    from src.core import storage

    # A store of this test's own, installed as the configured one: the
    # directory in the configuration belongs to the container image, and
    # `for_config()` would try to create it.
    store = storage.LocalStorage(
        str(tmp_path / "objects"), secret="test-secret", prefix=Config.API_PREFIX
    )
    monkeypatch.setattr(storage, "_store", store)

    key = "probe/blob-endpoint.txt"
    store.put(key, b"the bytes", content_type="text/plain")
    try:
        expires = int(time.time()) + 300
        signature = store.sign(key, expires)
        base = f"{Config.API_PREFIX}/api/files/blob?key={key}"

        good = client.get(f"{base}&expires={expires}&signature={signature}")
        assert good.status_code == 200
        assert good.data == b"the bytes"
        # Saved by default, shown only when asked (§20).
        assert good.headers["Content-Disposition"].startswith("attachment")
        shown = client.get(f"{base}&expires={expires}&signature={signature}&inline=1")
        assert shown.headers["Content-Disposition"].startswith("inline")

        # A tampered signature, a tampered key, an expired link, and no link
        # at all — each refused, and none with a 500.
        assert client.get(f"{base}&expires={expires}&signature={signature[:-1]}0").status_code == 400
        assert client.get(
            f"{Config.API_PREFIX}/api/files/blob?key=probe/other.txt"
            f"&expires={expires}&signature={signature}"
        ).status_code == 400
        stale = int(time.time()) - 10
        assert client.get(
            f"{base}&expires={stale}&signature={store.sign(key, stale)}"
        ).status_code == 400
        assert client.get(f"{Config.API_PREFIX}/api/files/blob").status_code == 400
    finally:
        store.delete(key)


def test_the_public_endpoints_answer_without_a_token(client):
    """The other half: the four that must stay reachable, still are.

    Without this the sweep above could be satisfied by making everything
    private, including the metadata the sign-in page cannot start without.

    "Not 401" rather than "200": `/health/status` reports **503** when a
    dependency is down, which is the whole point of it — and this suite runs
    with every dependency pointed at a closed port unless a database is
    configured. What is asserted is *reachability*, not health.
    """
    for url in PUBLIC:
        assert client.get(url).status_code != 401, url


def test_the_public_list_names_only_endpoints_that_exist():
    # A stale entry would be a hole nobody notices: it exempts a URL that has
    # moved, and the endpoint at its new address is swept as it should be —
    # until the day the old name comes back.
    mounted = {route["url"] for route in endpoint_map.routes()}
    assert set(PUBLIC) <= mounted


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
