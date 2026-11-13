"""The organization list and its catalogue."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import vocabulary
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import apply_filters, apply_sort, count_of, facets_for
from src.core.repository import get_or_404
from src.services.people.organizations.common import (
    DEFAULT_COLUMNS,
    MANAGE_PERMISSION,
    MAX_DEPTH,
    VIEW_PERMISSION,
    _fields,
    _people_by_organization,
    _statement,
    summarise,
)


def catalogue(session, *, principal) -> dict[str, Any]:
    """The vocabulary the organisation editor is built from."""
    principal.require(VIEW_PERMISSION)
    from src.models.identity import Organization, Region

    regions = session.scalars(select(Region).order_by(Region.name)).all()
    return {
        "fields": _fields().describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "tiers": list(vocabulary.ORG_TIER),
        "statuses": list(vocabulary.ORG_STATUS),
        "regions": [
            {
                "id": str(region.id),
                "name": region.name,
                "code": region.code,
                "timezone": region.timezone,
                "currency": region.currency,
            }
            for region in regions
        ],
        "max_depth": MAX_DEPTH,
        "total": count_of(session, _statement()),
        "can_manage": principal.can(MANAGE_PERMISSION),
        # So the page knows the tenant it should open on rather than guessing.
        "own_organization_id": str(principal.organization_id) if principal.organization_id else None,
        "industries": [
            value
            for (value,) in session.execute(
                select(Organization.industry)
                .where(Organization.industry.is_not(None), Organization.deleted_at.is_(None))
                .distinct()
                .order_by(Organization.industry)
            ).all()
        ],
    }


def listing(session, args, *, principal) -> dict[str, Any]:
    """Every organisation, filtered and faceted in PostgreSQL (§71)."""
    principal.require(VIEW_PERMISSION)
    from src.models.identity import Department, Team

    fields = _fields()
    page = parse_page(args, default_sort="name", default_order="asc")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="name")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()
    ids = [row.id for row in rows]

    people = _people_by_organization(session, ids)
    departments = _counts(session, Department, ids)
    teams = _counts(session, Team, ids)

    return envelope(
        [
            summarise(
                row,
                people=people.get(row.id, 0),
                departments=departments.get(row.id, 0),
                teams=teams.get(row.id, 0),
                commercial=principal.can(MANAGE_PERMISSION),
            )
            for row in rows
        ],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
        can_manage=principal.can(MANAGE_PERMISSION),
    )


def _counts(session, model, ids: list[Any]) -> dict[Any, int]:
    """Rows of `model` per organisation, in one query rather than per row."""
    if not ids:
        return {}
    rows = session.execute(
        select(model.organization_id, func.count())
        .where(model.organization_id.in_(ids), model.deleted_at.is_(None))
        .group_by(model.organization_id)
    ).all()
    return {key: int(count) for key, count in rows}


def _organization(session, organization_id: str):
    from src.models.identity import Organization

    row = get_or_404(
        session,
        Organization,
        parse_uuid(organization_id, field="id"),
        "That organization does not exist.",
        live=True,
    )
    return row


def _department(session, department_id: str):
    from src.models.identity import Department

    row = get_or_404(
        session,
        Department,
        parse_uuid(department_id, field="id"),
        "That department does not exist.",
        live=True,
    )
    return row
