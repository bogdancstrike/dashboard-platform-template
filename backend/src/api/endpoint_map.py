"""Reads and checks `maps/endpoint.json`, the API's source of truth.

QF's router (`framework.api.dynamic.generate_endpoints_from_config`) builds
every resource from that document, so the file *is* the API surface — adding an
endpoint means adding an entry there and a function it names.

QF resolves `module_name` lazily, inside the request. That is convenient and
it means a typo in a handler reference surfaces as a 500 the first time
somebody calls the endpoint, possibly months later. `verify()` imports the lot
at startup instead, so a bad map is a process that refuses to boot.

The namespace is also the URL prefix — QF mounts a namespace at `/{name}` —
which is why the single namespace here is called `platform` and matches
`Config.API_PREFIX`. `check_prefix()` holds the two to each other.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

#: `backend/` — QF resolves `endpoint_json_path` against this.
BACKEND_ROOT = Path(__file__).resolve().parents[2]

#: Relative, because that is what `FrameworkSettings.endpoint_json_path` wants.
ENDPOINT_MAP_RELATIVE = "maps/endpoint.json"
ENDPOINT_MAP = BACKEND_ROOT / ENDPOINT_MAP_RELATIVE


@lru_cache(maxsize=4)
def load(path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path) if path else ENDPOINT_MAP
    if not target.exists():
        raise FileNotFoundError(
            f"endpoint map not found at {target}. The API surface is declared "
            "there; the process cannot serve anything without it."
        )
    document = json.loads(target.read_text(encoding="utf-8"))
    for key in ("namespaces", "models", "endpoints"):
        if key not in document:
            raise ValueError(f"{target}: missing required key {key!r}")
    return document


def namespaces(path: str | Path | None = None) -> list[dict[str, str]]:
    return list(load(path)["namespaces"])


def routes(path: str | Path | None = None) -> list[dict[str, Any]]:
    """The endpoints, normalised into the shape `/meta/routes` publishes.

    `url` is the full mounted path: QF prefixes a namespace's endpoints with
    `/{namespace}`, so that is reproduced here rather than guessed at.
    """
    document = load(path)
    out = []
    for entry in document["endpoints"]:
        namespace = entry["namespace"]
        exec_method = entry["exec_method"]
        out.append(
            {
                "operation": entry["operation_name"],
                "namespace": namespace,
                "url": f"/{namespace}{entry['api_url']}",
                "methods": [m.upper() for m in entry["request_method"]],
                "description": entry.get("description", ""),
                "handler": f"{exec_method['module_name']}:{exec_method['method_name']}",
            }
        )
    return out


def verify(path: str | Path | None = None) -> None:
    """Structural checks, then import every handler the map names."""
    import importlib

    document = load(path)
    declared = {ns["name"] for ns in document["namespaces"]}
    seen: dict[str, str] = {}

    for entry in document["endpoints"]:
        operation = entry.get("operation_name")
        if not operation:
            raise ValueError("every endpoint needs an operation_name")
        if operation in seen:
            raise ValueError(
                f"duplicate operation_name {operation!r} — Flask-RESTX registers "
                f"one endpoint per name, so the second silently replaces the first "
                f"(already used by {seen[operation]})"
            )

        namespace = entry.get("namespace")
        if namespace not in declared:
            raise ValueError(f"{operation}: namespace {namespace!r} is not declared")

        url = entry.get("api_url") or ""
        if not url.startswith("/"):
            raise ValueError(f"{operation}: api_url must start with '/' (got {url!r})")
        # QF strips a leading `/{namespace}` from api_url before mounting, so a
        # path that repeats its namespace loses that segment with no error.
        if url == f"/{namespace}" or url.startswith(f"/{namespace}/"):
            raise ValueError(
                f"{operation}: api_url {url!r} must not repeat its namespace "
                f"{namespace!r} — QF strips that prefix"
            )

        if not entry.get("request_method"):
            raise ValueError(f"{operation}: request_method must list at least one verb")

        model_name = entry.get("model_name")
        if model_name is not None and model_name not in document["models"]:
            raise ValueError(f"{operation}: model_name {model_name!r} is not declared")

        exec_method = entry.get("exec_method") or {}
        module_name = exec_method.get("module_name")
        method_name = exec_method.get("method_name")
        if not module_name or not method_name:
            raise ValueError(f"{operation}: exec_method needs module_name and method_name")

        module = importlib.import_module(module_name)
        if not callable(getattr(module, method_name, None)):
            raise ImportError(f"{operation}: {module_name} has no callable {method_name!r}")

        seen[operation] = f"{module_name}:{method_name}"


def check_prefix(api_prefix: str, path: str | Path | None = None) -> None:
    """A namespace is mounted at `/{name}`, so it has to agree with API_PREFIX.

    Nothing in QF ties the two together, and the failure is quiet: every route
    still mounts, just not where the frontend, the proxy and the docs expect.
    """
    expected = api_prefix.strip("/")
    declared = {ns["name"] for ns in load(path)["namespaces"]}
    if expected and expected not in declared:
        raise ValueError(
            f"API_PREFIX is {api_prefix!r} but the endpoint map declares "
            f"{sorted(declared)}. One namespace must be named {expected!r}, "
            "or nothing will be served under the prefix."
        )


def main(argv: list[str] | None = None) -> int:
    """`python -m src.api.endpoint_map` — check the map, then print the surface."""
    import sys

    from src.config import Config

    verify()
    check_prefix(Config.API_PREFIX)
    for route in routes():
        methods = ",".join(route["methods"])
        print(f"{methods:<12} {route['url']:<40} {route['handler']}")
    print(f"\n{len(routes())} endpoints, map is valid")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
