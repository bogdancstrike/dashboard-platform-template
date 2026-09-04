"""The people directory — who a thing can be shared with, or assigned to.

Every "pick a person" control in the application asks the same question, so
there is one answer to it rather than one per feature: a short, searchable list
of active colleagues, with just enough on each to tell two people of the same
name apart.

Deliberately narrow. It is not the user administration endpoint (§12) and must
never grow into one: a viewer may need to share a saved search with a
colleague, and that is not a reason to let them read the colleague's login
history. What is returned here is what appears on a business card.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, select

from src.core.pagination import envelope, parse_page
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of

#: Enough to fill a picker; anything longer is answered by typing, not scrolling.
MAX_PEOPLE = 50


def _fields() -> FieldSet:
    from src.models.identity import User

    return FieldSet(
        Field("name", User.full_name, searchable=True, label="Name", aliases=("full_name",)),
        Field("email", User.email, searchable=True),
        Field("username", User.username, searchable=True),
        Field("job_title", User.job_title, searchable=True, label="Job title"),
        Field("status", User.status, kind="enum", filterable=False),
        Field("organization_id", User.organization_id, kind="uuid", filterable=False),
    )


def _base_statement() -> Select:
    """Active, undeleted people only.

    A picker offering someone who left the company produces a share nobody
    receives, and the reader has no way to tell that from a share that worked.
    """
    from src.models.identity import User

    return select(User).where(User.deleted_at.is_(None), User.status == "ACTIVE")


def people(session, args, *, principal) -> dict[str, Any]:
    """Search colleagues by name, email, username or job title."""
    fields = _fields()
    page = parse_page(args, default_sort="name", default_order="asc")
    page.page_size = min(page.page_size, MAX_PEOPLE)

    statement = apply_filters(_base_statement(), args, fields)
    total = count_of(session, statement)
    statement = apply_sort(statement, page, fields, default="name")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).unique().all()

    return envelope([_serialize(row, principal) for row in rows], total, page)


def _serialize(user, principal) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "name": user.full_name,
        "email": user.email,
        "username": user.username,
        "job_title": user.job_title,
        "avatar_url": user.avatar_url,
        "initials": _initials(user.full_name),
        #: Lets a picker mark "you" without the caller comparing ids itself.
        "is_me": user.id == principal.user_id,
    }


def _initials(name: str) -> str:
    parts = [part for part in str(name or "").split() if part]
    if not parts:
        return "?"
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()
