"""The layering rule, asserted rather than described (§architecture).

`docs/architecture.md` says the backend has four layers and which way the
imports point. A document that says that and nothing that checks it is a
document that is true on the day it is written: the first handler that reaches
for `select()` because it was quicker, or the first `core` module that imports
a service because it needed one dataset's rule, breaks the shape without
breaking anything visible — and then the next person copies it.

The rule, from the outside in:

* **`api/` holds no logic.** A handler names its permission, opens a
  transaction, calls a service and returns what it said. It may not query,
  because a query in a handler is a rule that lives outside the service that
  owns it — and the list endpoint would then answer differently from the
  export that is supposed to be the same question.
* **`services/` know nothing about HTTP.** They take a session and a principal
  and raise typed errors; a service that reached for `flask.request` could not
  be called by the seed, the importer, or another service.
* **`core/` knows nothing about a dataset.** `query`, `pagination`, `sharing`,
  `audit`, `storage`, `export` are mechanisms. The moment one of them imports a
  service it has an opinion about tickets, and the next dataset needs a second
  copy of it.
* **`models/` describe the schema and import nothing of ours.** They are what
  `create_all`, the migrations, the repair and every service read; a model that
  imported a service would make the schema depend on behaviour.

Read from the source rather than by importing, so a cycle cannot make the test
itself fail to load — and so it sees imports inside functions, which is where
a layering violation usually hides.
"""

from __future__ import annotations

import pathlib
import re

import pytest

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"

#: Which packages each layer may import from ours. `config` is settings and is
#: readable everywhere; `seed` is a tool that sits outside the layering and may
#: read all of it.
ALLOWED: dict[str, set[str]] = {
    "models": {"models", "config"},
    "core": {"core", "models", "config"},
    "services": {"services", "core", "models", "config"},
    "api": {"api", "services", "core", "models", "config"},
    "seed": {"seed", "services", "core", "models", "config"},
}

#: What a layer may not name at all, whatever the module.
FORBIDDEN_MODULES: dict[str, tuple[str, ...]] = {
    # A service that reads `flask.request` cannot be called by the seed, the
    # importer or another service — and those are its three other callers.
    "services": ("flask",),
    "models": ("flask", "sqlalchemy.orm.session"),
}

#: Querying belongs to the layer that owns the question.
SQL_IN_HANDLERS = re.compile(r"\b(?:select\(|session\.execute\(|session\.query\()")


def modules(layer: str) -> list[pathlib.Path]:
    return sorted(path for path in (SRC / layer).glob("*.py") if path.name != "__init__.py")


def imported(path: pathlib.Path) -> set[str]:
    """The `src.<package>` names a module imports, wherever the import sits."""
    text = path.read_text()
    return {
        match.group(1)
        for match in re.finditer(r"(?:from|import)\s+src\.([a-z_]+)", text)
    }


LAYERS = sorted(ALLOWED)


@pytest.mark.parametrize("layer", LAYERS)
def test_a_layer_imports_only_what_it_is_allowed_to(layer: str):
    found = modules(layer)
    # Guard against the test passing by looking at nothing, which is how a
    # glob-based rule goes quiet after a directory is renamed.
    assert len(found) > 3, f"no modules found for {layer}"

    for path in found:
        for package in imported(path):
            assert package in ALLOWED[layer], (
                f"src/{layer}/{path.name} imports src.{package}, "
                f"which {layer} may not depend on"
            )


@pytest.mark.parametrize("layer", sorted(FORBIDDEN_MODULES))
def test_a_layer_does_not_reach_for_what_it_must_not_know(layer: str):
    for path in modules(layer):
        text = path.read_text()
        for forbidden in FORBIDDEN_MODULES[layer]:
            assert f"import {forbidden}" not in text, (
                f"src/{layer}/{path.name} imports {forbidden}"
            )


def _modules_serving_only_public_endpoints() -> set[str]:
    """Handler modules every one of whose endpoints is deliberately public.

    Derived from `test_endpoint_map.PUBLIC` — the one declaration of what may
    answer without a credential, each entry with its reason — rather than by
    naming `health.py` here. A second list of exemptions is how an endpoint
    ends up exempt in one test and asserted in the other.
    """
    import json

    from tests.test_endpoint_map import PUBLIC

    payload = json.loads((SRC.parent / "maps/endpoint.json").read_text())
    namespace = payload["namespace_name"] if "namespace_name" in payload else "platform"
    by_module: dict[str, list[bool]] = {}
    for entry in payload["endpoints"]:
        module = str(entry["exec_method"]["module_name"])
        if not module.startswith("src.api."):
            continue
        address = f"/{entry['namespace']}{entry['api_url']}" if entry.get("namespace") else (
            f"/{namespace}{entry['api_url']}"
        )
        by_module.setdefault(module.rsplit(".", 1)[1], []).append(address in PUBLIC)
    return {name for name, flags in by_module.items() if all(flags)}


def test_a_handler_names_a_permission_and_calls_a_service():
    """Every endpoint module is thin, and gated.

    Two properties, both of which have failed elsewhere in this file's absence:
    a handler that queries directly is a rule outside its service, and a
    handler with no `@requires` is an endpoint whose only protection is that
    nobody found it (`test_endpoint_map.py` is the other half of that).
    """
    public = _modules_serving_only_public_endpoints()
    # The health probes, and nothing else — asserted, so a module that becomes
    # entirely public by accident shows up here rather than being waved past.
    assert public == {"health"}, public

    for path in modules("api"):
        text = path.read_text()
        # `app.py` assembles the process and `endpoint_map.py` validates the
        # map; neither is a handler module.
        if path.name in {"app.py", "endpoint_map.py"}:
            continue
        if path.stem in public:
            continue
        # The socket is not a QF-mounted resource and cannot carry a decorator
        # that reads `flask.request` in the same way: it verifies the token
        # itself and closes on failure, which `test_websocket.py` asserts.
        if path.name == "websocket.py":
            assert "verify_token" in text, "the socket no longer verifies its token"
            continue
        assert not SQL_IN_HANDLERS.search(text), f"src/api/{path.name} queries the database"
        assert "@requires" in text or "@authenticated" in text or "@optional" in text, (
            f"src/api/{path.name} has no gated handler"
        )


def test_the_layers_are_the_layers_the_document_describes():
    """The document names four layers plus the seed; this is where that stops
    being true if a fifth is added without deciding what it may import."""
    assert sorted(ALLOWED) == ["api", "core", "models", "seed", "services"]
    for layer in ALLOWED:
        assert (SRC / layer).is_dir(), f"src/{layer} is in the rule and not on disk"
