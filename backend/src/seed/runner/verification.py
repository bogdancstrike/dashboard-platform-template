"""Referential and consistency checks over what the seed wrote (a check pipeline).

A seed that silently produces an orphan costs an afternoon later, when a list
page 500s on a join nobody suspected. Each check appends what it finds.
"""

from __future__ import annotations

from sqlalchemy import and_, func, select
from sqlalchemy.orm import aliased

from src.seed.runner import checks_people as people
from src.seed.runner import checks_records as records

#: The checks, in the order their findings are reported.
CHECKS = (
    records.check_orphans,
    records.check_exports,
    records.check_imports,
    people.check_current_sessions,
    people.check_favourite_flags,
    people.check_share_permissions,
    people.check_search_members,
    people.check_self_management,
    people.check_project_counters,
    people.check_personas,
    people.check_scopes,
    people.check_tags_cache,
    people.check_reports,
    people.check_automations,
    people.check_headcounts,
)


def _orphan_counter(session, problems: list[str]):
    def _orphans(label: str, child, child_fk, parent) -> None:
        # Aliased unconditionally: `users.manager_id` points back at `users`,
        # and a self-join without an alias is "table name specified more than
        # once" rather than an answer.
        target = aliased(parent)
        missing = session.scalar(
            select(func.count())
            .select_from(child)
            .outerjoin(target, child_fk == target.id)
            .where(and_(child_fk.is_not(None), target.id.is_(None)))
        )
        if missing:
            problems.append(f"{label}: {missing} rows point at a missing parent")
    return _orphans


def verify(session) -> list[str]:
    """Every check's findings, in order; empty when the seed is consistent."""
    problems: list[str] = []
    orphans = _orphan_counter(session, problems)
    for check in CHECKS:
        check(session, problems, orphans)
    return problems
