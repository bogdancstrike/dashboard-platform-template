"""Seed checks: sessions, favourites, sharing, the org chart, personas, scopes, and derived data."""

from __future__ import annotations

from sqlalchemy import and_, cast, func, select
from sqlalchemy.dialects.postgresql import UUID as PgUUID

from src.models.business import Project, Task
from src.models.identity import User
from src.models.personal import (
    Dashboard,
    ResourceShare,
    SavedSearch,
)
from src.seed.runner.compile_drift import _unrunnable_automations, _unrunnable_reports
from src.seed.runner.drift import _headcount_drift, _tags_out_of_step


def check_current_sessions(session, problems: list[str], _orphans) -> None:
    # At most one session per person may be the current one, and it has to be
    # a live one. `is_current=index < 5` marked the first five sessions of
    # *every* user, so somebody with three had three of them claiming to be
    # the one they were reading the page from (§41).
    from src.models.identity import UserSession as _Session

    doubled = session.execute(
        select(_Session.user_id, func.count())
        .where(_Session.is_current.is_(True))
        .group_by(_Session.user_id)
        .having(func.count() > 1)
    ).all()
    for user_id, count in doubled:
        problems.append(f"user {user_id}: {count} sessions each claim to be the current one")

    dead = session.scalar(
        select(func.count())
        .select_from(_Session)
        .where(_Session.is_current.is_(True), _Session.revoked_at.is_not(None))
    )
    if dead:
        problems.append(f"user_sessions: {dead} revoked session(s) still marked current")


def check_favourite_flags(session, problems: list[str], _orphans) -> None:
    # The old per-row favourite flags must be empty: `favorites` is the one
    # store now, and a `true` here is a star `/favorites` cannot see (§38).
    from src.models.personal import Report as _Report
    from src.models.personal import SavedSearch as _Search

    for model, label in ((_Report, "reports"), (_Search, "saved_searches")):
        stale = session.scalar(
            select(func.count()).select_from(model).where(model.is_favorite.is_(True))
        )
        if stale:
            problems.append(
                f"{label}: {stale} row(s) still carry the old is_favorite flag — "
                "run `make sync-favorites`"
            )


def check_share_permissions(session, problems: list[str], _orphans) -> None:
    # A share grants read, never write (§5) — editing belongs to the owner.
    writable = session.scalar(
        select(func.count()).select_from(ResourceShare).where(ResourceShare.permission != "VIEW")
    )
    if writable:
        problems.append(f"resource_shares: {writable} rows grant more than VIEW")


def check_search_members(session, problems: list[str], _orphans) -> None:
    # An owner cannot be a member of their own search; the row would be dead
    # data that the visibility query has to remember to ignore.
    self_shared = session.scalar(
        select(func.count())
        .select_from(ResourceShare)
        .join(SavedSearch, SavedSearch.id == cast(ResourceShare.resource_id, PgUUID))
        .where(
            and_(
                ResourceShare.resource_type == "saved_search",
                ResourceShare.user_id == SavedSearch.owner_id,
            )
        )
    )
    if self_shared:
        problems.append(f"resource_shares: {self_shared} rows share a search with its own owner")


def check_self_management(session, problems: list[str], _orphans) -> None:
    # Nobody may manage themselves; the org chart would recurse forever.
    self_managing = session.scalar(
        select(func.count()).select_from(User).where(User.manager_id == User.id)
    )
    if self_managing:
        problems.append(f"users.manager_id: {self_managing} users manage themselves")


def check_project_counters(session, problems: list[str], _orphans) -> None:
    # The denormalised project counters are only worth having if they are true.
    stale = session.execute(
        select(Project.code, Project.task_count, func.count(Task.id))
        .outerjoin(Task, Task.project_id == Project.id)
        .group_by(Project.id, Project.code, Project.task_count)
        .having(Project.task_count != func.count(Task.id))
    ).all()
    if stale:
        problems.append(f"projects.task_count: {len(stale)} projects disagree with their tasks")


def check_personas(session, problems: list[str], _orphans) -> None:
    # The five realm personas must exist, or a reviewer signs in to an empty app.
    from src.seed.identity import PERSONA_DOMAIN, PERSONAS

    for username, *_rest in PERSONAS:
        email = f"{username}@{PERSONA_DOMAIN}"
        if not session.scalar(select(func.count()).select_from(User).where(User.email == email)):
            problems.append(f"persona {email} is missing")


def check_scopes(session, problems: list[str], _orphans) -> None:
    # A scope the sharing model cannot express is a row nobody but its owner
    # can see and nobody at all can edit — and it fails silently, because
    # `sharing.visibility` simply has no branch for it. Reported here because
    # `--check` is where a database says what is wrong with it.
    from src.core.sharing import SCOPES
    from src.models.personal import Report

    for label, model in (
        ("dashboards", Dashboard), ("reports", Report),
        ("saved searches", SavedSearch),
    ):
        unknown = session.execute(
            select(model.scope, func.count())
            .where(model.scope.notin_(sorted(SCOPES)))
            .group_by(model.scope)
        ).all()
        for scope, count in unknown:
            problems.append(
                f"{count} {label} carry scope {scope}, which the sharing model "
                f"cannot express — allowed: {', '.join(sorted(SCOPES))}"
            )


def check_tags_cache(session, problems: list[str], _orphans) -> None:
    # The `tags` array is a *derived* cache of `tag_links` with exactly one
    # writer (`services/tags._resync`). A derived column is only a decision
    # while something asserts it; two stores for one fact is what it becomes
    # otherwise, which is how 44 tagged tasks and 28 tag links came to
    # disagree. `--sync-tags` is the repair this reports.
    problems.extend(_tags_out_of_step(session))


def check_reports(session, problems: list[str], _orphans) -> None:
    # A saved report whose definition the compiler would reject is a row that
    # looks fine in psql and fails the moment somebody opens `/reports`. Every
    # seeded report was one of these — the dimensions were drawn from a
    # literal list of column names no dataset declares — and nothing said so
    # until a screenshot showed "region cannot be grouped by".
    problems.extend(_unrunnable_reports(session))


def check_automations(session, problems: list[str], _orphans) -> None:
    # And the same class of fault in the automations, for the same reason:
    # a rule that cannot compile its condition reports quiet rather than
    # broken, which is the one thing a monitor must never do (§49).
    problems.extend(_unrunnable_automations(session))


def check_headcounts(session, problems: list[str], _orphans) -> None:
    # And a number that contradicts the directory it summarises: `headcount`
    # was drawn at random before the users existed, so Support stored 116 with
    # nobody assigned to it (§57).
    problems.extend(_headcount_drift(session))
