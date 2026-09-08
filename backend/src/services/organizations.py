"""Organizations, departments and teams (§42): the shape of the company.

One tenant, its departments nested inside each other, and the teams that sit in
those. Three tables and one screen, because they are one question: *where does
a person sit, and who is above them?*

Five decisions worth stating.

**Headcount is computed, never read.** `departments.headcount` is a stored
column that was drawn at random before the users existed — so Support said 116
people with nobody at all assigned to it. Two numbers for one fact, and the
stored one lied. This service counts `users.department_id`, so the API is right
even if the column drifts again; `--sync-org` and `--check` keep the column
honest for anything reading it directly.

**A department's headcount is its own, not its subtree's.** Rolling children up
into a parent makes the numbers on a tree sum to more than the organisation
employs, which is the same defect the other way round. The subtree total is
offered as its own figure, named as such.

**The tree is built once, in Python, from one query.** A recursive CTE per node
or a `selectinload` per level is how a four-level structure becomes forty
queries; the rows come back flat and are threaded here.

**A department cannot become its own ancestor.** Re-parenting is the one edit
that can corrupt the structure — a cycle makes the tree infinite and every page
that walks it hang — so the move is refused with the path named.

**Deleting is refused while anything is inside.** Unlike a group, which is a
set, a department is a *place*: people and teams point at it, and
`ondelete="CASCADE"` on those columns means a silent delete would take the
teams with it and orphan the people. So it says what is in the way and leaves
the operator to move them.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Select, func, select

from src.core import audit, vocabulary
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for

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

    row = session.get(Organization, parse_uuid(organization_id, field="id"))
    if row is None or row.deleted_at is not None:
        raise NotFoundError("That organization does not exist.")
    return row


def _department(session, department_id: str):
    from src.models.identity import Department

    row = session.get(Department, parse_uuid(department_id, field="id"))
    if row is None or row.deleted_at is not None:
        raise NotFoundError("That department does not exist.")
    return row


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


def update(session, organization_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Edit a tenant's own details."""
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    row = _organization(session, organization_id)

    before = {"name": row.name, "tier": row.tier, "status": row.status}
    if "name" in payload:
        row.name = _checked_name(payload.get("name"))
        row.slug = _slug(row.name)
    if "tier" in payload:
        row.tier = _one_of(payload.get("tier"), vocabulary.ORG_TIER, "tier")
    if "status" in payload:
        row.status = _one_of(payload.get("status"), vocabulary.ORG_STATUS, "status")
    for field in ("legal_name", "industry", "website", "email", "phone", "address_line", "city", "country"):
        if field in payload:
            setattr(row, field, str(payload.get(field) or "").strip() or None)
    if "employee_count" in payload:
        row.employee_count = _positive(payload.get("employee_count"), "employee_count")

    audit.record(
        session,
        action="UPDATE",
        resource_type="organization",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after={"name": row.name, "tier": row.tier, "status": row.status},
        message=f"edited {row.name}",
    )
    session.flush()
    return summarise(
        row,
        people=_people_by_organization(session, [row.id]).get(row.id, 0),
        # The caller holds `orgs.manage` to have got here at all.
        commercial=True,
    )


def _one_of(value: Any, allowed: tuple[str, ...], field: str) -> str:
    wanted = str(value or "").strip().upper()
    if wanted not in allowed:
        raise ValidationError(
            f"{wanted!r} is not a {field}.",
            details={"value": wanted, "allowed": list(allowed)},
        )
    return wanted


def _positive(value: Any, field: str) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be a whole number.") from None
    if number < 0:
        raise ValidationError(f"{field} cannot be negative.")
    return number


def create_department(
    session, organization_id: str, payload: dict[str, Any], *, principal
) -> dict[str, Any]:
    """Add a department, optionally inside another."""
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    from src.models.identity import Department

    organization = _organization(session, organization_id)
    name = _checked_name(payload.get("name"))
    code = _checked_code(payload.get("code"))

    parent = None
    if payload.get("parent_id"):
        parent = _department(session, str(payload["parent_id"]))
        if parent.organization_id != organization.id:
            raise ValidationError(
                "A department cannot sit inside one from another organization.",
                details={"parent_id": str(parent.id)},
            )
        if _depth_of(session, parent) + 1 >= MAX_DEPTH:
            raise ConflictError(
                f"{MAX_DEPTH} levels is as deep as the structure goes — "
                "past that nobody can read the indentation.",
                details={"max_depth": MAX_DEPTH},
            )

    clash = session.scalar(
        select(Department).where(
            Department.organization_id == organization.id,
            Department.code == code,
            Department.deleted_at.is_(None),
        )
    )
    if clash is not None:
        raise ConflictError(
            f"{organization.name} already has a {code} — {clash.name}.",
            details={"code": code, "existing": str(clash.id)},
        )

    row = Department(
        name=name,
        code=code,
        description=str(payload.get("description") or "").strip() or None,
        organization_id=organization.id,
        parent_id=parent.id if parent else None,
        cost_center=str(payload.get("cost_center") or "").strip() or None,
        # Derived, always: see `_people_by_department`. Nobody is in it yet.
        headcount=0,
    )
    session.add(row)
    session.flush()

    audit.record(
        session,
        action="CREATE",
        resource_type="department",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        after={"name": row.name, "code": row.code, "parent_id": str(row.parent_id or "")},
        message=f"added {row.name} to {organization.name}",
    )
    return {
        "id": str(row.id),
        "name": row.name,
        "code": row.code,
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "people": 0,
    }


def _depth_of(session, row) -> int:
    """How far down a department already sits.

    Walks upward with a visit set rather than trusting the structure: this is
    the function that has to be safe when a cycle exists, since it is what
    prevents one being created.
    """
    from src.models.identity import Department

    depth = 0
    seen = {row.id}
    current = row
    while current.parent_id is not None and depth < MAX_DEPTH + 2:
        if current.parent_id in seen:
            break
        seen.add(current.parent_id)
        current = session.get(Department, current.parent_id)
        if current is None:
            break
        depth += 1
    return depth


def move_department(
    session, department_id: str, payload: dict[str, Any], *, principal
) -> dict[str, Any]:
    """Re-parent a department, or edit it.

    The one edit that can corrupt the structure. A department that became its
    own ancestor would make the tree infinite and hang every page that walks
    it, so the cycle is refused with the offending path named — a bare "invalid
    parent" leaves somebody guessing which of four levels was the problem.
    """
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    row = _department(session, department_id)

    before = {"name": row.name, "code": row.code, "parent_id": str(row.parent_id or "")}
    if "name" in payload:
        row.name = _checked_name(payload.get("name"))
    if "code" in payload:
        row.code = _checked_code(payload.get("code"))
    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None
    if "cost_center" in payload:
        row.cost_center = str(payload.get("cost_center") or "").strip() or None

    if "parent_id" in payload:
        wanted = payload.get("parent_id")
        if not wanted:
            row.parent_id = None
        else:
            parent = _department(session, str(wanted))
            if parent.id == row.id:
                raise ConflictError(
                    f"{row.name} cannot sit inside itself.",
                    details={"department": str(row.id)},
                )
            if parent.organization_id != row.organization_id:
                raise ValidationError(
                    "A department cannot move into another organization.",
                    details={"parent_id": str(parent.id)},
                )
            path = _ancestry(session, parent)
            if row.id in {item.id for item in path}:
                raise ConflictError(
                    f"That would put {row.name} inside itself — "
                    + " → ".join(item.name for item in reversed(path)),
                    details={"path": [str(item.id) for item in path]},
                )
            if len(path) >= MAX_DEPTH:
                raise ConflictError(
                    f"{MAX_DEPTH} levels is as deep as the structure goes.",
                    details={"max_depth": MAX_DEPTH},
                )
            row.parent_id = parent.id

    audit.record(
        session,
        action="UPDATE",
        resource_type="department",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after={"name": row.name, "code": row.code, "parent_id": str(row.parent_id or "")},
        message=f"edited {row.name}",
    )
    session.flush()
    return {
        "id": str(row.id),
        "name": row.name,
        "code": row.code,
        "parent_id": str(row.parent_id) if row.parent_id else None,
    }


def _ancestry(session, row) -> list:
    """A department and everything above it, nearest first.

    Bounded by `MAX_DEPTH + 2` rather than trusting termination: if a cycle
    ever did exist, the function that detects cycles must not be the one that
    hangs on them.
    """
    from src.models.identity import Department

    chain = [row]
    current = row
    while current.parent_id is not None and len(chain) < MAX_DEPTH + 2:
        parent = session.get(Department, current.parent_id)
        if parent is None or parent.id in {item.id for item in chain}:
            break
        chain.append(parent)
        current = parent
    return chain


def remove_department(session, department_id: str, *, principal) -> dict[str, Any]:
    """Retire a department, refusing while anything is still inside it.

    Unlike a group — which is a set of people and can be dissolved — a
    department is a *place*: users and teams point at it, and the foreign keys
    cascade. A silent delete would take the teams with it and leave the people
    pointing at nothing, so this says what is in the way instead.
    """
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    from src.models.identity import Department, Team, User

    row = _department(session, department_id)

    people = int(
        session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.department_id == row.id, User.deleted_at.is_(None))
        )
        or 0
    )
    teams = int(
        session.scalar(
            select(func.count())
            .select_from(Team)
            .where(Team.department_id == row.id, Team.deleted_at.is_(None))
        )
        or 0
    )
    children = int(
        session.scalar(
            select(func.count())
            .select_from(Department)
            .where(Department.parent_id == row.id, Department.deleted_at.is_(None))
        )
        or 0
    )

    blocking = [
        label
        for label, count in (
            (f"{people} {'person' if people == 1 else 'people'}", people),
            (f"{teams} {'team' if teams == 1 else 'teams'}", teams),
            (f"{children} sub-{'department' if children == 1 else 'departments'}", children),
        )
        if count
    ]
    if blocking:
        raise ConflictError(
            f"{row.name} still has {', '.join(blocking)}. Move them first.",
            details={"people": people, "teams": teams, "children": children},
        )

    label = row.name
    row.deleted_at = now()
    audit.record(
        session,
        action="DELETE",
        resource_type="department",
        resource_id=row.id,
        resource_label=label,
        principal=principal,
        message=f"retired {label}",
    )
    session.flush()
    return {"deleted": True, "id": str(row.id), "name": label}
