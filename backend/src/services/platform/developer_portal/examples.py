"""Sample responses, and schemas inferred from them."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ValidationError
from src.services.platform.developer_portal.api_reference import _example, _raw_map
from src.services.platform.developer_portal.guards import (
    SAMPLE_CHARS,
    SAMPLE_DEPTH,
    SAMPLE_ITEMS,
    USAGE_PERMISSION,
)


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
