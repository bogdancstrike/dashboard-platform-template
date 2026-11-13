"""The organization tree, with the people in each node."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.services.people.organizations.common import (
    MANAGE_PERMISSION,
    MAX_DEPTH,
    VIEW_PERMISSION,
    _people_by_department,
    summarise,
)
from src.services.people.organizations.listing_view import _organization


def tree(session, organization_id: str, *, principal) -> dict[str, Any]:
    """One organisation's whole structure: departments nested, teams inside them.

    Built from three flat queries and threaded in Python. A recursive CTE per
    node, or a `selectinload` per level, is how a four-level structure becomes
    forty queries — and the whole shape is a few dozen rows, so fetching it at
    once is both simpler and faster.
    """
    principal.require(VIEW_PERMISSION)
    from src.models.identity import Department, Team, User

    organization = _organization(session, organization_id)

    departments = session.scalars(
        select(Department)
        .where(
            Department.organization_id == organization.id,
            Department.deleted_at.is_(None),
        )
        .order_by(Department.name)
    ).all()
    teams = session.scalars(
        select(Team)
        .where(Team.organization_id == organization.id, Team.deleted_at.is_(None))
        .order_by(Team.name)
    ).all()

    people = _people_by_department(session, organization.id)
    leads = _people_named(
        session,
        {team.lead_id for team in teams} | {row.manager_id for row in departments},
    )

    teams_by_department: dict[Any, list[dict[str, Any]]] = {}
    for team in teams:
        teams_by_department.setdefault(team.department_id, []).append(
            {
                "id": str(team.id),
                "name": team.name,
                "slug": team.slug,
                "description": team.description,
                "color": team.color,
                "lead": leads.get(team.lead_id),
            }
        )

    children: dict[Any, list] = {}
    for row in departments:
        children.setdefault(row.parent_id, []).append(row)

    def branch(row, depth: int) -> dict[str, Any]:
        below = [branch(child, depth + 1) for child in children.get(row.id, [])]
        own = people.get(row.id, 0)
        return {
            "id": str(row.id),
            "name": row.name,
            "code": row.code,
            "description": row.description,
            "cost_center": row.cost_center,
            "parent_id": str(row.parent_id) if row.parent_id else None,
            "manager": leads.get(row.manager_id),
            "depth": depth,
            # Its own people, and the subtree's, as two separate numbers.
            # Rolling children into the parent makes a tree sum to more than
            # the organisation employs.
            "people": own,
            "people_in_subtree": own + sum(child["people_in_subtree"] for child in below),
            "teams": teams_by_department.get(row.id, []),
            "children": below,
        }

    roots = [branch(row, 0) for row in children.get(None, [])]
    return {
        "organization": summarise(
            organization,
            people=sum(people.values()),
            departments=len(departments),
            teams=len(teams),
            commercial=principal.can(MANAGE_PERMISSION),
        ),
        "departments": roots,
        # Teams that belong to the organisation but sit in no department. Named
        # rather than hidden: a team nobody can find on the tree is a team
        # somebody will create a second copy of.
        "unplaced_teams": teams_by_department.get(None, []),
        "depth": _depth(roots),
        "max_depth": MAX_DEPTH,
        "can_manage": principal.can(MANAGE_PERMISSION),
        "unassigned_people": _unassigned(session, organization.id, User),
    }


def _depth(nodes: list[dict[str, Any]]) -> int:
    """How deep the tree actually goes, so the page can say when it is full."""
    return 1 + max((_depth(node["children"]) for node in nodes), default=-1) if nodes else 0


def _unassigned(session, organization_id: Any, User) -> int:
    """People in the organisation who sit in no department.

    Surfaced because it is the number that explains a tree summing to less
    than the organisation's own headcount — otherwise somebody spends an
    afternoon looking for the missing forty.
    """
    return int(
        session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == organization_id,
                User.department_id.is_(None),
                User.deleted_at.is_(None),
            )
        )
        or 0
    )


def _people_named(session, ids: set[Any]) -> dict[Any, dict[str, Any]]:
    """The managers and leads a tree mentions, in one query."""
    from src.core.naming import initials
    from src.models.identity import User

    wanted = {item for item in ids if item is not None}
    if not wanted:
        return {}
    rows = session.scalars(select(User).where(User.id.in_(wanted))).all()
    return {
        row.id: {
            "id": str(row.id),
            "full_name": row.full_name,
            "initials": initials(row.full_name),
            "avatar_url": row.avatar_url,
            "job_title": row.job_title,
        }
        for row in rows
    }
