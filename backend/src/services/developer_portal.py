"""The developer portal (§31): an API reference read from the platform itself.

Nothing in the reference is typed by hand. The routes, methods and one-line
descriptions come from `maps/endpoint.json` — the table QF mounts — so an
endpoint is documented the day it exists. Who may call each one comes from the
handler's own guard (`@requires(...)`, `@authenticated`, `@optional`), read off
the decorator, so the permission on the page is the permission the code checks.
The longer description is the handler's docstring. Mounted parameters and the
operation id come from the Swagger document Flask-RESTX publishes at
`/swagger.json`. And the response shape is inferred from a real answer captured
by the try-it console (or seeded), so the schema shown is one this deployment
has actually returned.

Usage is computed from `api_request_logs` in PostgreSQL — requests per day,
errors, p50/p95 latency and the busiest routes, per API client.
"""

from __future__ import annotations

import importlib
import inspect
import re
from datetime import timedelta
from typing import Any

from sqlalchemy import Integer, case, cast, func, select

from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid

USAGE_PERMISSION = "api.manage"

#: How much of a captured response is kept: lists to this many items, strings
#: to this many characters, nesting to this depth.
SAMPLE_ITEMS = 3
SAMPLE_CHARS = 240
SAMPLE_DEPTH = 6

_PARAM = re.compile(r"<(?:(?P<kind>[a-z]+):)?(?P<name>[a-z_]+)>")

#: Shown above the reference; dates are the releases' own.
CHANGELOG: list[dict[str, Any]] = [
    {"version": "1.9", "date": "2026-11-13", "title": "Workflows as graphs",
     "items": ["`/api/automations/rules/<id>/graph` — draft, publish, versions, test runs",
               "Webhook triggers at `/platform/public/automations/hooks/<token>`",
               "API keys authenticate with the `X-Api-Key` header"]},
    {"version": "1.8", "date": "2026-11-12", "title": "Time, decisions and collaboration",
     "items": ["Approvals inbox, SLA policies, intake forms and time tracking endpoints",
               "Team chat, record threads and the wiki under `/api/chat` and `/api/docs`"]},
    {"version": "1.7", "date": "2026-11-12", "title": "Work planning and the assistant",
     "items": ["Sprints, epics, dependencies and the timeline under `/api/work`",
               "The AI assistant, daily brief and document Q&A under `/api/assistant` and `/api/knowledge`"]},
    {"version": "1.6", "date": "2026-09-10", "title": "Report documents",
     "items": ["Composed report documents with blocks under `/api/report-documents`"]},
]


# ── Reference ────────────────────────────────────────────────────────────


def _guard(module_name: str, method_name: str) -> dict[str, Any]:
    """Who may call a handler, read off its decorators, and its docstring."""
    try:
        module = importlib.import_module(module_name)
        handler = getattr(module, method_name)
    except (ImportError, AttributeError):
        return {"access": "unknown", "permissions": [], "doc": ""}
    permissions = list(getattr(handler, "__platform_permissions__", ()) or ())
    doc = inspect.getdoc(handler) or ""
    access = "permission" if permissions else "authenticated"
    try:
        source = inspect.getsource(module)
        match = re.search(rf"((?:^@[^\n]*\n)+)def {re.escape(method_name)}\(", source, re.M)
        decorators = match.group(1) if match else ""
    except (OSError, TypeError):
        decorators = ""
    if not permissions:
        if "@optional" in decorators:
            access = "public"
        elif "@authenticated" not in decorators and "@requires" not in decorators:
            access = "public"
    return {"access": access, "permissions": permissions, "doc": doc}


def _group(url: str) -> str:
    parts = [part for part in url.split("/") if part]
    if not parts:
        return "platform"
    if parts[0] in ("api", "public") and len(parts) > 1:
        return parts[1] if parts[0] == "api" else f"public-{parts[1]}"
    return parts[0]


def _swagger() -> dict[str, Any]:
    """Flask-RESTX's own document, fetched once per process."""
    cached = _SWAGGER.get("doc")
    if cached is not None:
        return cached
    document: dict[str, Any] = {}
    try:
        from flask import current_app

        with current_app.test_client() as client:
            response = client.get("/swagger.json")
            if response.status_code == 200:
                document = response.get_json() or {}
    except Exception:  # noqa: BLE001 - the reference stands without it
        document = {}
    _SWAGGER["doc"] = document
    return document


_SWAGGER: dict[str, Any] = {}


def _swagger_path(url: str, prefix: str) -> str:
    return prefix + _PARAM.sub(lambda m: "{" + m.group("name") + "}", url)


def reference(session, *, principal) -> dict[str, Any]:
    """Every endpoint, grouped, with access, parameters and any captured example."""
    from src.core import endpoint_catalog as endpoint_map
    from src.config import Config
    from src.models.developers import ApiExample

    prefix = Config.API_PREFIX.rstrip("/")
    swagger_paths = (_swagger().get("paths") or {})
    examples = {(row.method, row.route): row for row in session.scalars(select(ApiExample)).all()}
    entries = endpoint_map.load()["endpoints"]

    groups: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        url = entry["api_url"]
        execute = entry.get("exec_method") or {}
        guard = _guard(execute.get("module_name", ""), execute.get("method_name", ""))
        swagger = swagger_paths.get(_swagger_path(url, prefix)) or {}
        for method in entry.get("request_method") or ["GET"]:
            example = examples.get((method, url))
            operation = swagger.get(method.lower()) or {}
            groups.setdefault(_group(url), []).append({
                "id": f"{method} {url}",
                "method": method,
                "route": url,
                "path": prefix + url,
                "operation": entry.get("operation_name"),
                "summary": entry.get("description") or "",
                "description": guard["doc"],
                "access": guard["access"],
                "permissions": guard["permissions"],
                "allowed": not guard["permissions"] or principal.can(*guard["permissions"]),
                "parameters": [
                    {"name": m.group("name"), "in": "path", "type": m.group("kind") or "string"}
                    for m in _PARAM.finditer(url)
                ],
                "swagger": {"operation_id": operation.get("operationId"),
                            "parameters": [p.get("name") for p in operation.get("parameters") or []]}
                if operation else None,
                "body": method in ("POST", "PUT", "PATCH"),
                "example": _example(example) if example else None,
            })
    ordered = [
        {"key": key, "label": key.replace("-", " ").replace("_", " ").title(),
         "endpoints": sorted(items, key=lambda item: (item["route"], item["method"]))}
        for key, items in sorted(groups.items())
    ]
    return {
        "base_path": prefix,
        "groups": ordered,
        "total": sum(len(group["endpoints"]) for group in ordered),
        "documented": sum(1 for group in ordered for item in group["endpoints"] if item["example"]),
        "auth": {
            "bearer": "Authorization: Bearer <access token from Keycloak>",
            "api_key": "X-Api-Key: nuc_… (an API client's credential, shown once at creation)",
        },
        "swagger_url": "/swagger.json",
        "changelog": CHANGELOG,
        "can_capture": principal.can(USAGE_PERMISSION),
        "can_view_usage": principal.can(USAGE_PERMISSION),
    }


def _raw_map() -> dict[str, Any]:
    from src.core import endpoint_catalog as endpoint_map

    return endpoint_map.load()


def _example(row) -> dict[str, Any]:
    return {
        "status_code": row.status_code,
        "path": row.path,
        "request_body": row.request_body,
        "response": row.response_sample,
        "schema": row.response_schema,
        "duration_ms": row.duration_ms,
        "captured_at": iso(row.captured_at),
    }


# ── Examples ─────────────────────────────────────────────────────────────


def sample(value: Any, depth: int = 0) -> Any:
    """A response cut down to something a page can show."""
    if depth >= SAMPLE_DEPTH:
        return "…"
    if isinstance(value, dict):
        return {str(key): sample(item, depth + 1) for key, item in list(value.items())[:40]}
    if isinstance(value, list):
        return [sample(item, depth + 1) for item in value[:SAMPLE_ITEMS]]
    if isinstance(value, str) and len(value) > SAMPLE_CHARS:
        return value[:SAMPLE_CHARS] + "…"
    return value


def infer_schema(value: Any, depth: int = 0) -> dict[str, Any]:
    """A JSON-Schema-shaped description of one value."""
    if depth >= SAMPLE_DEPTH:
        return {}
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", value):
            return {"type": "string", "format": "uuid"}
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?", value):
            return {"type": "string", "format": "date-time"}
        return {"type": "string"}
    if isinstance(value, list):
        return {"type": "array", "items": infer_schema(value[0], depth + 1) if value else {}}
    if isinstance(value, dict):
        return {"type": "object",
                "properties": {str(k): infer_schema(v, depth + 1) for k, v in list(value.items())[:40]}}
    return {}


def capture(session, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Keep a successful console call as the route's example."""
    from src.models.developers import ApiExample

    principal.require(USAGE_PERMISSION)
    body = payload if isinstance(payload, dict) else {}
    method = str(body.get("method") or "").upper()
    route = str(body.get("route") or "")
    known = {(m, e["api_url"]) for e in _raw_map()["endpoints"] for m in e.get("request_method") or []}
    if (method, route) not in known:
        raise ValidationError("That route and method are not in the endpoint map.",
                              details={"method": method, "route": route})
    try:
        status = int(body.get("status_code") or 200)
    except (TypeError, ValueError) as error:
        raise ValidationError("status_code must be a number.") from error
    if not 200 <= status < 300:
        raise ValidationError("Only a successful response is kept as an example.")
    row = session.scalar(select(ApiExample).where(ApiExample.method == method, ApiExample.route == route))
    if row is None:
        row = ApiExample(method=method, route=route)
        session.add(row)
    response = body.get("response")
    row.status_code = status
    row.path = str(body.get("path") or "")[:500] or None
    row.request_body = sample(body.get("request_body")) if body.get("request_body") is not None else None
    row.response_sample = sample(response)
    row.response_schema = infer_schema(response)
    row.duration_ms = int(body["duration_ms"]) if isinstance(body.get("duration_ms"), (int, float)) else None
    row.captured_by_id = getattr(principal, "user_id", None)
    row.captured_at = now()
    session.flush()
    return {"method": method, "route": route, "example": _example(row)}


# ── Usage ────────────────────────────────────────────────────────────────


def usage(session, args, *, principal) -> dict[str, Any]:
    """Requests, errors, latency and the busiest routes — overall or for one client."""
    from src.models.platform import ApiClient, ApiRequestLog

    principal.require(USAGE_PERMISSION)
    try:
        days = max(1, min(int(args.get("days") or 14), 90))
    except (TypeError, ValueError) as error:
        raise ValidationError("days must be a whole number.") from error
    since = now() - timedelta(days=days)
    log = ApiRequestLog
    where = [log.requested_at >= since]
    client = None
    if args.get("client"):
        client = session.get(ApiClient, parse_uuid(args.get("client"), field="client"))
        if client is None or client.deleted_at is not None:
            raise NotFoundError("That API client does not exist.")
        where.append(log.api_client_id == client.id)

    failed = case((log.status_code >= 400, 1), else_=0)
    day = func.date_trunc("day", log.requested_at)
    series = session.execute(
        select(day.label("day"), func.count().label("requests"), func.sum(failed).label("errors"),
               func.percentile_cont(0.5).within_group(log.duration_ms).label("p50"),
               func.percentile_cont(0.95).within_group(log.duration_ms).label("p95"))
        .where(*where).group_by(day).order_by(day)
    ).all()
    top = session.execute(
        select(log.method, log.path, func.count().label("requests"), func.sum(failed).label("errors"),
               func.avg(log.duration_ms).label("avg_ms"))
        .where(*where).group_by(log.method, log.path).order_by(func.count().desc()).limit(10)
    ).all()
    codes = session.execute(
        select(log.status_code, func.count()).where(*where).group_by(log.status_code).order_by(log.status_code)
    ).all()
    per_client = session.execute(
        select(ApiClient.id, ApiClient.name, ApiClient.client_id, ApiClient.status,
               func.count(log.id).label("requests"), func.coalesce(func.sum(cast(log.status_code >= 400, Integer)), 0).label("errors"),
               func.percentile_cont(0.95).within_group(log.duration_ms).label("p95"),
               func.max(log.requested_at).label("last"))
        .join(log, (log.api_client_id == ApiClient.id) & (log.requested_at >= since), isouter=True)
        .where(ApiClient.deleted_at.is_(None))
        .group_by(ApiClient.id).order_by(func.count(log.id).desc())
    ).all()
    total = sum(int(row.requests) for row in series)
    errors = sum(int(row.errors or 0) for row in series)
    return {
        "days": days,
        "client": {"id": str(client.id), "name": client.name} if client else None,
        "totals": {
            "requests": total,
            "errors": errors,
            "error_rate": round(errors / total, 4) if total else 0,
            "p95_ms": round(max((float(r.p95 or 0) for r in series), default=0), 1),
        },
        "series": [{"day": iso(row.day)[:10], "requests": int(row.requests), "errors": int(row.errors or 0),
                    "p50_ms": round(float(row.p50 or 0), 1), "p95_ms": round(float(row.p95 or 0), 1)}
                   for row in series],
        "top_endpoints": [{"method": row.method, "path": row.path, "requests": int(row.requests),
                           "errors": int(row.errors or 0), "avg_ms": round(float(row.avg_ms or 0), 1)}
                          for row in top],
        "status_codes": [{"code": int(code), "count": int(count)} for code, count in codes],
        "clients": [{"id": str(row.id), "name": row.name, "client_id": row.client_id, "status": row.status,
                     "requests": int(row.requests), "errors": int(row.errors or 0),
                     "p95_ms": round(float(row.p95 or 0), 1), "last_used_at": iso(row.last)}
                    for row in per_client],
    }
