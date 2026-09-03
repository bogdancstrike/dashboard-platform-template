"""Builds the whole dataset in memory, then writes it in one transaction.

Two decisions carry the design:

**Everything is built before anything is written.** Ids are generated from the
seeded stream up front, so a project can reference a customer that has not been
inserted yet and the whole graph is consistent by construction rather than by a
sequence of read-back queries.

**Cross-table cycles are deferred, not avoided.** `users.manager_id` points at
`users`, `departments.manager_id` points at `users` while `users.department_id`
points back at `departments`. PostgreSQL checks a foreign key at INSERT, not at
COMMIT, so those columns are held back, everything is inserted, and then they
are filled in and flushed a second time. The alternative — making the
constraints DEFERRABLE — changes the schema to suit the seed, which is the
wrong way round.
"""

from __future__ import annotations

import time
from typing import Any

from src.config import Config
from src.core.clock import now
from src.seed import business, content, identity, operations, personal
from src.seed.support import Rng
from src.seed.world import SCALES, Scale, World

#: (table attribute on World) in an order that satisfies every foreign key.
#: SQLAlchemy sorts mappers itself, but ordering here keeps the flush
#: predictable and makes the dependency chain readable in one place.
INSERT_ORDER: tuple[str, ...] = (
    # identity
    "regions", "roles", "organizations", "departments", "teams", "groups",
    "users", "sessions", "login_events", "security_events",
    # business
    "customers", "projects", "tasks", "tickets", "orders", "devices",
    "calendar_events",
    # content
    "tags", "folders", "files", "email_templates", "email_threads",
    "email_messages", "email_attachments", "comments", "tag_links",
    # platform operations
    "system_settings", "service_health", "feature_flags", "integrations",
    "scheduled_tasks", "background_jobs", "api_clients", "api_credentials",
    "api_request_logs", "alert_rules", "import_runs", "audit_logs",
    "activity_entries", "system_logs", "notifications",
    # personalization
    "notification_preferences", "saved_searches", "resource_shares",
    "saved_views", "dashboards", "dashboard_widgets", "reports", "favorites",
    "recent_items",
)

#: (World attribute, column) pairs whose value points at a row in a table that
#: is inserted later, or at the same table further down the list.
DEFERRED_LINKS: tuple[tuple[str, str], ...] = (
    ("users", "manager_id"),
    ("departments", "manager_id"),
    ("teams", "lead_id"),
)


def bootstrap_schema(engine) -> None:
    """Create every table. Importing `src.models` is what registers them."""
    import src.models as models

    models.Base.metadata.create_all(engine)


def drop_schema(engine) -> None:
    import src.models as models

    models.Base.metadata.drop_all(engine)


def is_seeded(session) -> bool:
    """True when the database already holds a dataset.

    Checked on `users` rather than on row counts everywhere: the seed is
    all-or-nothing, so one populated table means the rest are too.
    """
    from sqlalchemy import func, select

    from src.models.identity import User

    return bool(session.scalar(select(func.count()).select_from(User)))


def generate(*, scale: Scale, seed: int) -> World:
    """Build the dataset in memory. Touches no database."""
    anchor = now()
    world = World(rng=Rng(seed, anchor), scale=scale, anchor=anchor)
    identity.build(world)
    business.build(world)
    content.build(world)
    operations.build(world)
    personal.build(world)
    return world


def write(session, world: World) -> dict[str, int]:
    """Insert the whole graph. One transaction, committed by the caller."""
    deferred: list[tuple[Any, str, Any]] = []
    for attribute, column in DEFERRED_LINKS:
        for row in getattr(world, attribute):
            value = getattr(row, column, None)
            if value is not None:
                deferred.append((row, column, value))
                setattr(row, column, None)

    # Flushed per table, in the order above, rather than once at the end.
    # SQLAlchemy's unit of work sorts inserts by *relationship* dependencies,
    # and most of these foreign keys are plain columns with no relationship on
    # them — `system_settings.updated_by_id` is a reference to `users` the ORM
    # has no way to know about. Left to sort itself out, it interleaves them
    # and PostgreSQL rejects the first row whose parent has not landed yet.
    for attribute in INSERT_ORDER:
        rows = getattr(world, attribute)
        if rows:
            session.add_all(rows)
            session.flush()

    for row, column, value in deferred:
        setattr(row, column, value)
    session.flush()

    return world.counts()


def run(
    session,
    *,
    scale: str | Scale = "full",
    seed: int | None = None,
) -> dict[str, int]:
    """Generate and write, returning row counts per table."""
    from framework.commons.logger import logger as log

    resolved = scale if isinstance(scale, Scale) else SCALES[str(scale)]
    seed_value = Config.SEED_RANDOM_SEED if seed is None else seed

    started = time.perf_counter()
    world = generate(scale=resolved, seed=seed_value)
    built = time.perf_counter()
    counts = write(session, world)
    written = time.perf_counter()

    log.info(
        f"seed[{resolved.name}] {world.total()} rows across {len(counts)} tables "
        f"(build {built - started:.1f}s, write {written - built:.1f}s, seed={seed_value})",
        "green",
    )
    return counts


def verify(session) -> list[str]:
    """Referential and consistency checks over what was just written.

    A seed that silently produces an orphan is a seed that costs an afternoon
    later, when a list page 500s on a join nobody suspected.
    """
    from sqlalchemy import and_, cast, func, select
    from sqlalchemy.dialects.postgresql import UUID as PgUUID
    from sqlalchemy.orm import aliased

    from src.models.business import Order, Project, Task, Ticket
    from src.models.content import Comment, EmailMessage, EmailThread, FileObject
    from src.models.identity import Department, Team, User
    from src.models.personal import Dashboard, DashboardWidget, ResourceShare, SavedSearch
    from src.models.platform import ActivityEntry, AuditLog, BackgroundJob

    problems: list[str] = []

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

    _orphans("tasks.project_id", Task, Task.project_id, Project)
    _orphans("tasks.assignee_id", Task, Task.assignee_id, User)
    _orphans("projects.owner_id", Project, Project.owner_id, User)
    _orphans("tickets.assignee_id", Ticket, Ticket.assignee_id, User)
    _orphans("orders.owner_id", Order, Order.owner_id, User)
    _orphans("users.manager_id", User, User.manager_id, User)
    _orphans("departments.manager_id", Department, Department.manager_id, User)
    _orphans("teams.lead_id", Team, Team.lead_id, User)
    _orphans("files.owner_id", FileObject, FileObject.owner_id, User)
    _orphans("comments.author_id", Comment, Comment.author_id, User)
    _orphans("audit_logs.actor_id", AuditLog, AuditLog.actor_id, User)
    _orphans("activity.actor_id", ActivityEntry, ActivityEntry.actor_id, User)
    _orphans("jobs.initiated_by_id", BackgroundJob, BackgroundJob.initiated_by_id, User)
    _orphans("widgets.dashboard_id", DashboardWidget, DashboardWidget.dashboard_id, Dashboard)
    _orphans("messages.thread_id", EmailMessage, EmailMessage.thread_id, EmailThread)

    _orphans("resource_shares.user_id", ResourceShare, ResourceShare.user_id, User)

    # A share grants read, never write (§5) — editing belongs to the owner.
    writable = session.scalar(
        select(func.count()).select_from(ResourceShare).where(ResourceShare.permission != "VIEW")
    )
    if writable:
        problems.append(f"resource_shares: {writable} rows grant more than VIEW")

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

    # Nobody may manage themselves; the org chart would recurse forever.
    self_managing = session.scalar(
        select(func.count()).select_from(User).where(User.manager_id == User.id)
    )
    if self_managing:
        problems.append(f"users.manager_id: {self_managing} users manage themselves")

    # The denormalised project counters are only worth having if they are true.
    stale = session.execute(
        select(Project.code, Project.task_count, func.count(Task.id))
        .outerjoin(Task, Task.project_id == Project.id)
        .group_by(Project.id, Project.code, Project.task_count)
        .having(Project.task_count != func.count(Task.id))
    ).all()
    if stale:
        problems.append(f"projects.task_count: {len(stale)} projects disagree with their tasks")

    # The five realm personas must exist, or a reviewer signs in to an empty app.
    from src.seed.identity import PERSONA_DOMAIN, PERSONAS

    for username, *_rest in PERSONAS:
        email = f"{username}@{PERSONA_DOMAIN}"
        if not session.scalar(select(func.count()).select_from(User).where(User.email == email)):
            problems.append(f"persona {email} is missing")

    return problems
