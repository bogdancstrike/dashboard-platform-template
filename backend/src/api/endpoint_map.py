"""Renders the route table into the JSON document QF's router consumes.

`framework.api.dynamic.generate_endpoints_from_config` reads a file, so this
writes one. It is generated rather than committed: a checked-in copy of a
derived file is a copy that goes stale, and the failure mode — a route that
exists in code but not in the map — is invisible until someone calls it.

Run it directly to inspect what the process will serve:

    python -m src.api.endpoint_map            # to stdout
    python -m src.api.endpoint_map maps/endpoint.json
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from src.api.routes import NAMESPACES, ROUTES, Route

#: Request-body models, in QF's field vocabulary (`string`, `boolean`,
#: `integer`, `list`, `dict`). A route naming one gets `@api.expect(model,
#: validate=True)` and a documented body in Swagger. Most routes name none —
#: see `Route.model`.
BODY_MODELS: dict[str, dict[str, dict[str, Any]]] = {}


def _check(route: Route) -> None:
    """Catch the two mistakes this indirection makes easy."""
    if not route.path.startswith("/"):
        raise ValueError(f"{route.operation}: path must start with '/' (got {route.path!r})")
    # QF strips a leading `/{namespace}` from `api_url`, so a path that repeats
    # its own namespace loses that segment without any error being raised.
    if route.path == f"/{route.namespace}" or route.path.startswith(f"/{route.namespace}/"):
        raise ValueError(
            f"{route.operation}: path {route.path!r} must not repeat its namespace "
            f"{route.namespace!r} — QF would strip it"
        )
    if route.namespace not in NAMESPACES:
        raise ValueError(f"{route.operation}: namespace {route.namespace!r} is undeclared")
    if route.model is not None and route.model not in BODY_MODELS:
        raise ValueError(f"{route.operation}: body model {route.model!r} is undeclared")


def build_map(routes: tuple[Route, ...] = ROUTES) -> dict[str, Any]:
    """The whole document, validated on the way out."""
    seen: dict[str, str] = {}
    endpoints = []
    for route in routes:
        _check(route)
        if route.operation in seen:
            raise ValueError(
                f"duplicate operation {route.operation!r} "
                f"(already used by {seen[route.operation]})"
            )
        seen[route.operation] = route.handler
        endpoints.append(
            {
                "namespace": route.namespace,
                "operation_name": route.operation,
                "model_name": route.model,
                "request_method": [m.upper() for m in route.methods],
                "api_url": route.path,
                "description": route.summary,
                "exec_method": {"module_name": route.module, "method_name": route.function},
            }
        )

    used = {route.namespace for route in routes}
    return {
        "namespaces": [
            {"name": name, "description": description}
            for name, description in NAMESPACES.items()
            if name in used
        ],
        "models": BODY_MODELS,
        "endpoints": endpoints,
    }


def verify_handlers(routes: tuple[Route, ...] = ROUTES) -> None:
    """Import every handler now, so a bad reference fails at startup.

    QF imports the module lazily, inside the request — without this, a renamed
    function surfaces as a 500 on the first call rather than a refusal to boot.
    """
    import importlib

    for route in routes:
        module = importlib.import_module(route.module)
        if not callable(getattr(module, route.function, None)):
            raise ImportError(
                f"{route.operation}: {route.module} has no callable {route.function!r}"
            )


def write_endpoint_map(path: str | Path | None = None) -> Path:
    """Write the map and return where it landed.

    Defaults to a per-process temporary file: several gunicorn workers start at
    once, and having them race to write the same path in the image would be a
    corrupt read for whichever loses.
    """
    document = build_map()
    if path is None:
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".endpoint.json", prefix="platform-", delete=False, encoding="utf-8"
        )
        with handle as out:
            json.dump(document, out, indent=2)
        return Path(handle.name)

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return target


def main(argv: list[str] | None = None) -> int:
    import sys

    args = list(sys.argv[1:] if argv is None else argv)
    verify_handlers()
    if args:
        written = write_endpoint_map(args[0])
        print(f"wrote {len(build_map()['endpoints'])} endpoints to {written}")
    else:
        print(json.dumps(build_map(), indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
