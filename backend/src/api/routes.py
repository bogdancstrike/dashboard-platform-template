"""The route table — one declaration per endpoint, in Python.

QF builds its endpoints from a JSON document (`framework.api.dynamic`), which
is fine for a handful of worker endpoints and unworkable for a platform with a
hundred. So the *table* lives here, in code, and `endpoint_map.py` renders the
JSON QF expects. Two things follow from that:

* a route is checked by the interpreter — a typo in a handler path is an
  ImportError at startup, not a 500 the first time somebody opens the page;
* the table is introspectable, which is what lets `/meta/routes` publish the
  API surface the frontend generates its client from.

Handlers keep QF's calling convention:

    def handler(app, operation, request, **path_params) -> tuple[dict, int]

`operation` is the operation name below, so one handler can serve several
routes when only the name distinguishes them.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Namespace → description. A namespace becomes one Swagger tag and one URL
#: segment: `/{API_PREFIX}/{namespace}/{path}`.
NAMESPACES: dict[str, str] = {
    "health": "Liveness, readiness and dependency health.",
    "meta": "Application metadata, permission catalogue and API surface.",
}


@dataclass(frozen=True, slots=True)
class Route:
    """One endpoint.

    `path` is relative to the namespace and must not begin with the namespace's
    own name — QF strips that prefix when it sees it, which would silently
    truncate the URL (`/health` under namespace `health` would become `/`).
    `endpoint_map` enforces that rather than leaving it to be discovered.
    """

    namespace: str
    operation: str
    path: str
    handler: str
    methods: tuple[str, ...] = ("GET",)
    summary: str = ""
    #: Name of a body model declared in `endpoint_map.BODY_MODELS`. Left unset
    #: for endpoints whose payload is validated by the handler itself, which is
    #: most of them: the domain errors give better messages than jsonschema.
    model: str | None = None

    @property
    def module(self) -> str:
        return self.handler.split(":", 1)[0]

    @property
    def function(self) -> str:
        return self.handler.split(":", 1)[1]

    @property
    def url(self) -> str:
        """The path as mounted, below the API prefix."""
        return f"/{self.namespace}{self.path}"


HEALTH_ROUTES: tuple[Route, ...] = (
    Route(
        namespace="health",
        operation="liveness",
        path="/live",
        handler="src.api.health:liveness",
        summary="Process is up. Never touches a dependency.",
    ),
    Route(
        namespace="health",
        operation="readiness",
        path="/ready",
        handler="src.api.health:readiness",
        summary="Ready to serve traffic — the database must answer.",
    ),
    Route(
        namespace="health",
        operation="health_snapshot",
        path="/status",
        handler="src.api.health:snapshot",
        summary="Every monitored dependency, with latency and last error.",
    ),
)

META_ROUTES: tuple[Route, ...] = (
    Route(
        namespace="meta",
        operation="meta_app",
        path="/app",
        handler="src.api.meta:application",
        summary="Branding and the OIDC coordinates the SPA needs before login.",
    ),
    Route(
        namespace="meta",
        operation="meta_permissions",
        path="/permissions",
        handler="src.api.meta:permissions",
        summary="The permission catalogue, grouped as the admin matrix renders it.",
    ),
    Route(
        namespace="meta",
        operation="meta_roles",
        path="/roles",
        handler="src.api.meta:roles",
        summary="Built-in role definitions and the permissions each carries.",
    ),
    Route(
        namespace="meta",
        operation="meta_routes",
        path="/routes",
        handler="src.api.meta:routes",
        summary="The API surface this process is serving.",
    ),
)


#: Every route the application serves. A new module appends its tuple here and
#: nowhere else — the endpoint map, the Swagger document and `/meta/routes` all
#: read this one list.
ROUTES: tuple[Route, ...] = HEALTH_ROUTES + META_ROUTES


def by_namespace() -> dict[str, list[Route]]:
    grouped: dict[str, list[Route]] = {name: [] for name in NAMESPACES}
    for route in ROUTES:
        grouped.setdefault(route.namespace, []).append(route)
    return grouped
