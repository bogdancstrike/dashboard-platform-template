"""Permissions, limits, columns and the checks organizations and departments share."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Select, func, select

from src.core import vocabulary
from src.core.clock import iso
from src.core.errors import ValidationError
from src.core.query import Field, FieldSet

#: Reading the structure. The same permission the directory needs: where
#: somebody sits is directory information.
VIEW_PERMISSION = "users.view"


#: Changing it — the tenants, their departments and their teams.
MANAGE_PERMISSION = "orgs.manage"


#: How deep the department tree may go.
#:
#: Not a technical limit but a legibility one: four levels of nesting is
#: already a structure nobody can hold in their head, and the indentation runs
#: out of horizontal room before the data runs out of depth.
MAX_DEPTH = 4


_CODE = re.compile(r"^[A-Z0-9][A-Z0-9\-]{1,31}$")


_NAME = re.compile(r"^[\w][\w \-&'/().—]{1,119}$", re.UNICODE)


def _fields() -> FieldSet:
    """Built lazily so importing this module does not pull the models at boot."""
    from src.models.identity import Organization

    return FieldSet(
        Field("name", Organization.name, searchable=True),
        Field("slug", Organization.slug, searchable=True),
        Field("legal_name", Organization.legal_name, searchable=True, label="Legal name"),
        Field("industry", Organization.industry, kind="enum", facet=True),
        Field("tier", Organization.tier, kind="enum", facet=True, choices=vocabulary.ORG_TIER),
        Field("status", Organization.status, kind="enum", facet=True,
              choices=vocabulary.ORG_STATUS),
        Field("city", Organization.city, kind="enum", facet=True),
        Field("country", Organization.country, kind="enum", facet=True),
        Field("employee_count", Organization.employee_count, kind="number",
              label="Employees"),
        Field("created_at", Organization.created_at, kind="datetime", label="Created"),
        Field("id", Organization.id, kind="uuid", label="Organization ID"),
    )


DEFAULT_COLUMNS = ("name", "tier", "industry", "country", "people")


def _statement() -> Select:
    from src.models.identity import Organization

    return select(Organization).where(Organization.deleted_at.is_(None))


def _checked_name(value: Any, *, what: str = "name") -> str:
    name = str(value or "").strip()
    if not _NAME.match(name):
        raise ValidationError(
            f"A {what} needs 2 to 120 characters, starting with a letter or digit.",
            details={"value": name},
        )
    return name


def _checked_code(value: Any) -> str:
    """A department code, upper-cased.

    Upper-cased rather than refused for being lower: `eng` and `ENG` are the
    same code to everybody except a string comparison, and a screen that
    refused one of them would be enforcing a rule nobody can see.
    """
    code = str(value or "").strip().upper()
    if not _CODE.match(code):
        raise ValidationError(
            "A department code is 2 to 32 characters: letters, digits and dashes.",
            details={"value": code},
        )
    return code


def _slug(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return cleaned or "organization"


def _people_by_organization(session, ids: list[Any]) -> dict[Any, int]:
    """People per organisation, in one query."""
    from src.models.identity import User

    if not ids:
        return {}
    rows = session.execute(
        select(User.organization_id, func.count())
        .where(User.organization_id.in_(ids), User.deleted_at.is_(None))
        .group_by(User.organization_id)
    ).all()
    return {key: int(count) for key, count in rows}


def _people_by_department(session, organization_id: Any = None) -> dict[Any, int]:
    """People per department, counted from where they actually sit.

    The whole reason this function exists rather than reading
    `departments.headcount`: that column was drawn at random before the users
    existed and said 116 for a department with nobody in it. `users
    .department_id` is the fact.
    """
    from src.models.identity import User

    statement = (
        select(User.department_id, func.count())
        .where(User.department_id.is_not(None), User.deleted_at.is_(None))
        .group_by(User.department_id)
    )
    if organization_id is not None:
        statement = statement.where(User.organization_id == organization_id)
    return {key: int(count) for key, count in session.execute(statement).all()}


def summarise(
    row,
    *,
    people: int = 0,
    departments: int = 0,
    teams: int = 0,
    commercial: bool = False,
) -> dict[str, Any]:
    """One organisation, as a table row.

    `commercial` gates the one field on this record that is nobody's business
    by default: `annual_revenue`. Reading the *structure* is directory
    information — where somebody sits, who manages them — and `users.view` is
    the right permission for it, which every role in the platform holds. What
    a tenant turns over is not, and shipping it to everybody who can open the
    staff directory would be a real over-exposure. Withheld rather than
    zeroed, so a reader can tell "not shown to you" from "nothing".
    """
    return {
        "id": str(row.id),
        "name": row.name,
        "slug": row.slug,
        "legal_name": row.legal_name,
        "industry": row.industry,
        "tier": row.tier,
        "status": row.status,
        "logo_url": row.logo_url,
        "website": row.website,
        "email": row.email,
        "phone": row.phone,
        "address_line": row.address_line,
        "city": row.city,
        "country": row.country,
        # What the *organisation record* claims, kept distinct from the number
        # of accounts the platform actually holds: a tenant of 4,000 staff with
        # 30 users is normal, and conflating them would make one of the two a
        # lie.
        "employee_count": int(row.employee_count or 0),
        **(
            {"annual_revenue": float(row.annual_revenue or 0.0)}
            if commercial
            else {}
        ),
        "people": people,
        "department_count": departments,
        "team_count": teams,
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
    }
