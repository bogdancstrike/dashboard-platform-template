"""A person's page: who they are and their team."""

from __future__ import annotations

from typing import Any

from src.core.clock import iso
from src.core.errors import ValidationError
from src.core.naming import initials
from src.services.people import users as directory_admin
from src.services.people.profile.activity_trail import _recent
from src.services.people.profile.work_stats import _analytics


def profile(session, who: Any, *, principal) -> dict[str, Any]:
    """One person's page. `who` is a user id, or empty for the caller."""
    person = _person(session, who, principal=principal)
    mine = person.id == principal.user_id

    # What this reader may be told about this person. Computed once and
    # published, so the page can *say* what it is not showing rather than
    # leaving a section mysteriously empty (§76).
    may_see_contact = mine or principal.can(directory_admin.VIEW_PERMISSION)
    may_see_access = mine or principal.can(directory_admin.VIEW_PERMISSION)
    may_see_activity = mine or principal.can("audit.view")

    body: dict[str, Any] = {
        "is_me": mine,
        "user": {
            "id": str(person.id),
            "full_name": person.full_name,
            "initials": initials(person.full_name),
            "username": person.username,
            "avatar_url": person.avatar_url,
            "job_title": person.job_title or "",
            "status": person.status,
            # Contact details are the half a directory withholds, so they are
            # absent rather than blank when the reader may not have them.
            **({"email": person.email, "phone": person.phone or ""} if may_see_contact else {}),
        },
        "role": {
            "code": person.role.code if person.role else None,
            "name": person.role.name if person.role else "",
            "color": person.role.color if person.role else "",
            "description": person.role.description if person.role else "",
        },
        "organization": _named(person.organization),
        "department": _named(person.department),
        # No `team` relationship on `User` — the column exists and the mapping
        # does not, so the name is looked up rather than navigated. Not worth a
        # relationship for one label on one page.
        "team": _team(session, person),
        "manager": _named(person.manager),
        "joined_at": iso(person.created_at),
        "last_login_at": iso(person.last_login_at),
        "login_count": person.login_count if may_see_contact else None,
        "locale": person.locale,
        "timezone": person.timezone,
        "mfa_enabled": bool(person.mfa_enabled),
        "visibility": {
            "contact": may_see_contact,
            "access": may_see_access,
            "activity": may_see_activity,
        },
        # Why the reader can do what they can, from the same function the
        # administrator's page uses.
        "groups": directory_admin.groups_of(person) if may_see_access else [],
        "access": directory_admin.access_of(person) if may_see_access else None,
        **_analytics(session, person),
    }
    if may_see_activity:
        body["recent_activity"] = _recent(session, person)
    return body


def _person(session, who: Any, *, principal):
    """The person a request is about — the caller unless it names somebody."""
    identifier = str(who or "").strip()
    if not identifier or identifier == "me":
        if principal.user_id is None:
            raise ValidationError("This request has no signed-in user.")
        return directory_admin.load_person(session, principal.user_id)
    return directory_admin.load_person(session, identifier)


def _team(session, person) -> dict[str, Any] | None:
    from src.models.identity import Team

    if person.team_id is None:
        return None
    return _named(session.get(Team, person.team_id))


def _named(row) -> dict[str, Any] | None:
    """An organization, a department, a team — or a *person*.

    All four are drawn the same way on the profile, and three of them carry a
    `name`. A `User` does not: people are named by `full_name`, because a
    platform with both would eventually disagree with itself about which was
    the display name. `manager` went through here anyway and raised
    `AttributeError` — a 500 on the page a person opens to look at themselves,
    and on every colleague's page too.
    """
    if row is None:
        return None
    name = getattr(row, "name", None) or getattr(row, "full_name", None) or ""
    return {"id": str(row.id), "name": name}
