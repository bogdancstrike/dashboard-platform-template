"""Repairing the org chart and roles."""

from __future__ import annotations

from sqlalchemy import select


def sync_org(session) -> dict[str, int]:
    """Make every department's `headcount` agree with the people in it.

    The sixth repair. Unlike the others it *edits* rather than inserts, and
    that is safe precisely because the column is derived: the truth is
    `users.department_id`, and this only stops the cached copy contradicting
    it. Nothing a person chose is overwritten.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.models.identity import Department, User

    actual = dict(
        session.execute(
            _select(User.department_id, func.count())
            .where(User.department_id.is_not(None), User.deleted_at.is_(None))
            .group_by(User.department_id)
        ).all()
    )
    corrected = 0
    for row in session.scalars(
        _select(Department).where(Department.deleted_at.is_(None))
    ).all():
        real = int(actual.get(row.id, 0))
        if int(row.headcount or 0) != real:
            row.headcount = real
            corrected += 1

    return {"corrected": corrected}


def sync_roles(session) -> dict[str, list[str]]:
    """Give the built-in roles every permission their declaration names.

    A permission that exists in code and in no role's row can be granted by
    nobody: `core/auth/users.permissions_for` reads the database, so adding one to
    the catalogue leaves every existing installation unable to use it until
    somebody grants it by hand. Seeding again is not an answer — it refuses to
    run on a populated database, and rightly.

    Additive on purpose. An administrator may have removed a permission from a
    system role deliberately through the matrix (§13), and reconciling *down*
    would silently undo that decision on the next deploy. Adding only means the
    worst case is a permission back that somebody has to remove again — which
    is visible, rather than an access grant that quietly disappears.
    """
    from src.core.auth import ROLE_DEFAULTS
    from src.models.identity import Role

    added: dict[str, list[str]] = {}
    for code, definition in ROLE_DEFAULTS.items():
        role = session.scalars(select(Role).where(Role.code == code)).one_or_none()
        if role is None:
            continue
        held = set(role.permissions or [])
        missing = [name for name in definition["permissions"] if name not in held]
        if missing:
            # Reassigned rather than mutated: an ARRAY column changed in place
            # is not seen as dirty by SQLAlchemy, and the UPDATE never happens.
            role.permissions = [*(role.permissions or []), *missing]
            added[code] = missing
    return added
