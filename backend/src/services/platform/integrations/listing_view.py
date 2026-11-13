"""Integrations: the catalogue, the list, one integration."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import vocabulary
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import apply_filters, apply_sort, count_of, facets_for
from src.core.repository import get_or_404
from src.services.platform.integrations.redaction import (
    _SECRETISH,
    DEFAULT_COLUMNS,
    PERMISSION,
    REDACTED,
    _fields,
    _statement,
    _visible_configuration,
    state,
    summarise,
)


def catalogue(session, *, principal) -> dict[str, Any]:
    """The categories and states, with a count against each."""
    principal.require(PERMISSION)
    from src.models.platform import Integration

    rows = session.scalars(_statement()).all()
    by_state: dict[str, int] = {}
    for row in rows:
        key = state(row)
        by_state[key] = by_state.get(key, 0) + 1

    counted = dict(
        session.execute(
            select(Integration.category, func.count())
            .where(Integration.deleted_at.is_(None))
            .group_by(Integration.category)
        ).all()
    )
    return {
        "fields": _fields().describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "categories": [
            {"key": category, "count": int(counted.get(category, 0))}
            for category in vocabulary.INTEGRATION_CATEGORY
        ],
        # Counted on the *derived* state, so the numbers agree with the rows.
        "states": [
            {"key": item, "count": by_state.get(item, 0)}
            for item in vocabulary.INTEGRATION_STATUS
        ],
        "total": len(rows),
        # The rows an operator should look at first: switched on and not
        # working. Surfaced as a number because it is the reason to open this
        # page at all.
        "needing_attention": sum(
            1 for row in rows if row.enabled and state(row) != "CONNECTED"
        ),
        "redacted": REDACTED,
    }


def listing(session, args, *, principal) -> dict[str, Any]:
    """Every integration, filtered and faceted in PostgreSQL (§71)."""
    principal.require(PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="name", default_order="asc")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="name")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [summarise(row) for row in rows],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
    )


def _integration(session, integration_id: str):
    from src.models.platform import Integration

    row = get_or_404(
        session,
        Integration,
        parse_uuid(integration_id, field="id"),
        "That integration does not exist.",
        live=True,
    )
    return row


def entry(session, integration_id: str, *, principal) -> dict[str, Any]:
    """One integration, with its configuration."""
    principal.require(PERMISSION)
    row = _integration(session, integration_id)
    return {
        **summarise(row),
        "configuration": _visible_configuration(row),
        # Which keys came back redacted, so the page can render them as "set,
        # not shown" rather than as a value somebody might try to edit.
        "redacted_settings": sorted(
            name
            for name, value in (row.configuration or {}).items()
            if _SECRETISH.search(name) and value
        ),
    }
