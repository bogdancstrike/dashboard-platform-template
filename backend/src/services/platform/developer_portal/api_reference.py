"""The API reference: endpoints grouped, with examples."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso
from src.services.platform.developer_portal.guards import (
    _PARAM,
    CHANGELOG,
    USAGE_PERMISSION,
    _group,
    _guard,
    _swagger,
    _swagger_path,
)


def reference(session, *, principal) -> dict[str, Any]:
    """Every endpoint, grouped, with access, parameters and any captured example."""
    from src.config import Config
    from src.core import endpoint_catalog as endpoint_map
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
