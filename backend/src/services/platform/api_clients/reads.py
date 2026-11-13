"""API clients: the list, its catalogue, one client."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import vocabulary
from src.core.auth import ALL_PERMISSIONS, PERMISSION_LABELS
from src.core.clock import iso
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import apply_filters, apply_sort, count_of, facets_for
from src.core.repository import get_or_404
from src.services.platform.api_clients.credentials import (
    DEFAULT_COLUMNS,
    MAX_REQUESTS,
    PERMISSION,
    ROTATION_GRACE_DAYS,
    _fields,
    _statement,
    credential_state,
    summarise_credential,
)


def summarise(row, *, credentials: int = 0, live: int = 0) -> dict[str, Any]:
    """One client, as a table row."""
    return {
        "id": str(row.id),
        "name": row.name,
        "client_id": row.client_id,
        "description": row.description,
        "status": row.status,
        "scopes": sorted(row.scopes or []),
        "rate_limit_per_minute": int(row.rate_limit_per_minute or 0),
        "quota_per_day": int(row.quota_per_day or 0),
        # Lifetime counters the gateway maintains. Not comparable with the
        # request log, which is a recent window — see the module docstring.
        "requests_today": int(row.requests_today or 0),
        "requests_total": int(row.requests_total or 0),
        "error_rate": float(row.error_rate or 0),
        "last_used_at": iso(row.last_used_at),
        "allowed_ips": list(row.allowed_ips or []),
        "credential_count": credentials,
        "live_credentials": live,
        "created_at": iso(row.created_at),
    }


def catalogue(session, *, principal) -> dict[str, Any]:
    """The vocabulary the client editor is built from."""
    principal.require(PERMISSION)

    return {
        "fields": _fields().describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "statuses": list(vocabulary.API_CLIENT_STATUS),
        # Only what the caller may actually grant. Offering the whole catalogue
        # and refusing half of it on save would be a form that produces an
        # error on purpose.
        "scopes": [
            {"code": code, "label": PERMISSION_LABELS.get(code, code)}
            for code in ALL_PERMISSIONS
            if principal.can(code)
        ],
        "withheld_scopes": [code for code in ALL_PERMISSIONS if not principal.can(code)],
        "rotation_grace_days": ROTATION_GRACE_DAYS,
        "total": count_of(session, _statement()),
    }


def _counts(session, ids: list[Any]) -> tuple[dict[Any, int], dict[Any, int]]:
    """Credentials per client, and how many of them still work."""
    from src.models.platform import ApiCredential

    if not ids:
        return {}, {}
    rows = session.scalars(
        select(ApiCredential).where(ApiCredential.api_client_id.in_(ids))
    ).all()
    total: dict[Any, int] = {}
    live: dict[Any, int] = {}
    for row in rows:
        total[row.api_client_id] = total.get(row.api_client_id, 0) + 1
        if credential_state(row) == "ACTIVE":
            live[row.api_client_id] = live.get(row.api_client_id, 0) + 1
    return total, live


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of clients, filtered and faceted in PostgreSQL (§71)."""
    principal.require(PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="name", default_order="asc")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="name")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    counted, live = _counts(session, [row.id for row in rows])
    return envelope(
        [
            summarise(row, credentials=counted.get(row.id, 0), live=live.get(row.id, 0))
            for row in rows
        ],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
    )


def _client(session, client_id: str):
    from src.models.platform import ApiClient

    row = get_or_404(
        session,
        ApiClient,
        parse_uuid(client_id, field="id"),
        "That API client does not exist.",
        live=True,
    )
    return row


def entry(session, client_id: str, *, principal) -> dict[str, Any]:
    """One client: its credentials, and the requests it has recently made."""
    principal.require(PERMISSION)
    from src.models.platform import ApiCredential, ApiRequestLog

    row = _client(session, client_id)
    credentials = session.scalars(
        select(ApiCredential)
        .where(ApiCredential.api_client_id == row.id)
        .order_by(ApiCredential.created_at.desc())
    ).all()
    requests = session.scalars(
        select(ApiRequestLog)
        .where(ApiRequestLog.api_client_id == row.id)
        .order_by(ApiRequestLog.requested_at.desc())
        .limit(MAX_REQUESTS)
    ).all()

    counted, live = _counts(session, [row.id])
    return {
        **summarise(row, credentials=counted.get(row.id, 0), live=live.get(row.id, 0)),
        "credentials": [summarise_credential(item) for item in credentials],
        "recent_requests": [
            {
                "id": str(item.id),
                "requested_at": iso(item.requested_at),
                "method": item.method,
                "path": item.path,
                "status_code": item.status_code,
                "duration_ms": float(item.duration_ms or 0),
                "ip_address": item.ip_address,
                "bytes_out": int(item.bytes_out or 0),
            }
            for item in requests
        ],
        # Said explicitly, because the number beside it is a *lifetime* total
        # and these are a window. Two questions, and a screen that put them
        # together unlabelled would read as one answer.
        "recent_window": len(requests),
        "recent_failures": sum(1 for item in requests if item.status_code >= 400),
    }
