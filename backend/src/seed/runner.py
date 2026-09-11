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
from copy import deepcopy
from pathlib import Path
from typing import Any

from sqlalchemy import select

from src.config import Config
from src.core.clock import now
from src.seed import blobs, business, content, identity, operations, personal, schema
from src.seed import exports as export_files
from src.seed import imports as import_runs
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
    "announcements", "announcement_receipts",
    # personalization
    "notification_preferences", "saved_searches", "resource_shares",
    "dashboards", "dashboard_widgets", "reports", "favorites",
    "recent_items",
    # Boards after their cards' assignees exist, and lanes before the cards
    # that point at them.
    "kanban_boards", "kanban_lanes", "kanban_cards",
)

#: (World attribute, column) pairs whose value points at a row in a table that
#: is inserted later, or at the same table further down the list.
DEFERRED_LINKS: tuple[tuple[str, str], ...] = (
    ("users", "manager_id"),
    ("departments", "manager_id"),
    ("teams", "lead_id"),
)


def bootstrap_schema(engine) -> None:
    """Create every table. Importing `src.models` is what registers them.

    `create_all` is silent about a table that already exists but has since
    grown a column in the model, which is how a running database ends up
    refusing every INSERT. So the drift is reported here rather than
    discovered later; applying it is `--sync-schema`, deliberately, because an
    unannounced ALTER on somebody's database is not a boot step.

    A first `docker compose up` should not need a second command, so the
    schema is still built from the models here rather than by running the
    migrations — and then **stamped**, so the database says which revision it
    is at. Without the stamp a database that already has every table is a
    database Alembic believes is empty, and the first `make migrate` on it
    tries to create all fifty-seven tables again.
    """
    import src.models as models

    models.Base.metadata.create_all(engine)
    stamp_head(engine)

    remaining = schema_drift(engine)
    if remaining:
        from framework.commons.logger import logger as log

        log.warning(
            "the database is behind the model: "
            + "; ".join(str(item) for item in remaining)
            + " — run 'python -m src.seed --sync-schema'",
            "yellow",
        )


def stamp_head(engine) -> str | None:
    """Record that this database is at the latest revision, if it is not yet.

    Only when the version table is *absent or empty*: stamping a database that
    is behind would tell Alembic a migration has run when it has not, which is
    the one lie that turns a pending upgrade into a silent corruption. Returns
    the revision recorded, or `None` when there was already one.
    """
    from alembic import command
    from alembic.config import Config as AlembicConfig
    from alembic.runtime.migration import MigrationContext

    with engine.connect() as connection:
        if MigrationContext.configure(connection).get_current_heads():
            return None

    root = Path(__file__).resolve().parents[2]
    config = AlembicConfig(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    # *This* database, which is not always the configured one: the migration
    # test builds a scratch database and stamps that. Without this the stamp
    # landed on whatever `DATABASE_URL` pointed at, which is the one mistake
    # in this area that is invisible until an upgrade skips a revision.
    config.set_main_option("sqlalchemy.url", engine.url.render_as_string(hide_password=False))
    command.stamp(config, "head")

    with engine.connect() as connection:
        heads = MigrationContext.configure(connection).get_current_heads()
    return heads[0] if heads else None


def schema_drift(engine) -> list[schema.Drift]:
    """What the model declares and the database does not have."""
    import src.models as models

    return [item for item in schema.drift(engine, models.Base.metadata) if item.column]


def sync_files(session) -> dict[str, int]:
    """Write the bytes for every seeded file that has none.

    Separate from `run` so it also serves an *existing* database — this one
    predates object storage, and its twenty file rows point at objects that
    were never written. Idempotent, so it is safe on every seed too.
    """
    from src.core import storage

    return blobs.materialise(session, storage.for_config())


def sync_exports(session) -> dict[str, int]:
    """Make every seeded export true, and write the file it claims (§30).

    Separate from `run` for the same reason `sync_files` is: it also serves an
    existing database, whose export rows claimed an artefact nobody had written
    and a row count that was a progress counter. Idempotent — an export whose
    object is already there is left alone.
    """
    from src.core import storage

    return export_files.materialise(session, storage.for_config())


def sync_searches(session) -> dict[str, int]:
    """Make saved searches runnable, and give every list one view it can show (§5, §46).

    Two repairs, both of which an existing database needs and neither of which
    a seed run will perform, because seeding refuses to touch a populated one.

    **Filter keys no dataset declares are dropped.** The generator used to
    write `filters={"q": …}`, and `q` is not a field: `apply_filters` iterates
    the *declared* fields and ignores anything else, so the row looked correct
    for as long as nothing applied it. The moment the entity lists could apply
    a saved search (§46) it put `f.q=overdue` in the address and counted it as
    a filter that narrows nothing.

    **Every dataset gets one public view a list can actually show.** A saved
    search carrying a condition tree is offered on a list as a link to the Data
    Explorer, because a tree of ANDs and ORs is not expressible in a row of
    facet selects — so a database whose saved searches all came from the rule
    builder demonstrates half of §46. The six in `catalog.LIST_VIEWS` are added
    if they are missing, owned by the personas in turn and public.

    Additive and idempotent: nothing existing is deleted or rewritten except
    the removal of filter keys that cannot work, and a view already present is
    left exactly as its owner has it.
    """
    from sqlalchemy import func, select as _select

    from src.models.identity import User
    from src.models.personal import SavedSearch
    from src.seed import catalog
    from src.seed.identity import PERSONA_DOMAIN, PERSONAS
    from src.seed.personal import COLUMN_SETS
    from src.services.explorer import resources as _resources

    catalogue = _resources()
    cleaned = 0
    added = 0

    for row in session.scalars(
        _select(SavedSearch).where(SavedSearch.deleted_at.is_(None))
    ).unique():
        resource = catalogue.get(row.resource_type)
        if resource is None or not isinstance(row.filters, dict):
            continue
        kept = {
            key: value
            for key, value in row.filters.items()
            if key in resource.fields.by_name and resource.fields.by_name[key].filterable
        }
        if len(kept) != len(row.filters):
            row.filters = kept
            cleaned += 1

    # The personas, in the order `identity` writes them, so which one owns
    # which view is the same in a repaired database as in a freshly seeded one.
    people: list[User] = []
    for username, *_rest in PERSONAS:
        person = session.scalars(
            _select(User).where(User.email == f"{username}@{PERSONA_DOMAIN}")
        ).one_or_none()
        if person is not None:
            people.append(person)
    if not people:
        return {"cleaned": cleaned, "added": added}

    for index, (name, resource_type, field, value) in enumerate(catalog.LIST_VIEWS):
        resource = catalogue.get(resource_type)
        if resource is None:
            continue
        exists = session.scalar(
            _select(func.count())
            .select_from(SavedSearch)
            .where(
                SavedSearch.name == name,
                SavedSearch.resource_type == resource_type,
                SavedSearch.deleted_at.is_(None),
            )
        )
        if exists:
            continue
        owner = people[index % len(people)]
        session.add(
            SavedSearch(
                name=name,
                description=f"Saved from the {resource_type} list.",
                resource_type=resource_type,
                owner_id=owner.id,
                organization_id=owner.organization_id,
                scope="PUBLIC",
                condition_tree=None,
                condition_text=None,
                filters={field: value},
                sort="updated_at",
                order="desc",
                columns=list(COLUMN_SETS.get(resource_type, ("name", "status"))),
                page_size=25,
                view_mode="table",
                is_default=False,
                rule_count=0,
                use_count=0,
            )
        )
        added += 1

    return {"cleaned": cleaned, "added": added}


def sync_tags(session) -> dict[str, int]:
    """Make each record's `tags` array agree with its links (§37).

    There were two stores for one fact, and nothing kept them in step: 44 tasks
    carried a `tags` array and 28 had `tag_links` rows, with no reason to think
    the two sets agreed. The same shape as the favourites defect, found the
    same way — by building the page that reads the data.

    `services/tags` now treats the *links* as the truth and the array as a
    derived cache with one writer. This is the repair that brings an existing
    database up to that: it rewrites the array of every record that has links,
    and *clears* it on every record that has an array and no links — because a
    string left behind after the link went is exactly the stale value the
    single-writer rule exists to prevent.

    Idempotent: a record already in step is written the same value.
    """
    from sqlalchemy import func, select as _select

    from src.models.content import Tag, TagLink
    from src.services.explorer import resources as _resources
    from src.services.tags import _resync

    rewritten = 0
    cleared = 0
    recounted = 0

    # Every record that has at least one link, by dataset.
    linked: dict[str, set[str]] = {}
    for resource_type, resource_id in session.execute(
        _select(TagLink.resource_type, TagLink.resource_id).distinct()
    ).all():
        linked.setdefault(str(resource_type), set()).add(str(resource_id))

    catalogue = _resources()
    for resource_type, ids in linked.items():
        if resource_type not in catalogue:
            continue
        for resource_id in ids:
            _resync(session, resource_type, resource_id)
            rewritten += 1

    # And the other direction: an array with no links behind it.
    for key, resource in catalogue.items():
        model = resource.model
        if not hasattr(model, "tags"):
            continue
        rows = session.scalars(
            _select(model).where(model.tags.isnot(None))
        ).unique().all()
        for row in rows:
            if str(row.id) in linked.get(key, set()):
                continue
            if row.tags:
                row.tags = None
                cleared += 1

    # The usage counts are the third derived value here, and the manager sorts
    # by them — a count that drifted would put the wrong tags at the top.
    for tag in session.scalars(_select(Tag)).all():
        wanted = int(
            session.scalar(
                _select(func.count()).select_from(TagLink).where(TagLink.tag_id == tag.id)
            )
            or 0
        )
        if tag.usage_count != wanted:
            tag.usage_count = wanted
            recounted += 1

    session.flush()
    return {"rewritten": rewritten, "cleared": cleared, "recounted": recounted}


def sync_favorites(session) -> dict[str, int]:
    """Move the old per-row `is_favorite` flags into the one store (§38).

    There were two stores for one fact. `favorites` is a table whose docstring
    reads "a bookmark on anything addressable" and which had no service at
    all, while `Report.is_favorite` and `SavedSearch.is_favorite` were boolean
    columns — and the saved-search drawer's own tooltip said "Add to
    favourites" while writing the column, so a reader could star a search, be
    told it went to their favourites, and find nothing there.

    This copies each flagged row into a `Favorite` and then *clears the
    column*, so `is_favorite = false` everywhere is the steady state and
    `--check` can assert exactly that. Keeping the columns in sync would be
    maintaining the second store the change exists to remove.

    Idempotent: a flag already migrated is already false, and a `Favorite`
    that exists is left alone.
    """
    from sqlalchemy import func as _func
    from sqlalchemy import select as _select

    from src.models.personal import Favorite, Report, SavedSearch

    moved = 0
    already = 0

    def _carry(row, *, resource_type: str, url: str, icon: str) -> None:
        nonlocal moved, already
        existing = session.scalar(
            _select(Favorite).where(
                Favorite.user_id == row.owner_id,
                Favorite.resource_type == resource_type,
                Favorite.resource_id == str(row.id),
            )
        )
        if existing is None:
            highest = session.scalar(
                _select(_func.max(Favorite.position)).where(Favorite.user_id == row.owner_id)
            )
            session.add(
                Favorite(
                    user_id=row.owner_id,
                    resource_type=resource_type,
                    resource_id=str(row.id),
                    label=(row.name or resource_type)[:240],
                    url=url,
                    icon=icon,
                    position=int(highest or 0) + 1,
                    # The star was made when the row was last touched, which is
                    # the closest true answer available.
                    created_at=row.updated_at or row.created_at,
                )
            )
            moved += 1
        else:
            already += 1
        # Cleared either way: the column is no longer where the answer lives.
        row.is_favorite = False

    for report in session.scalars(
        _select(Report).where(Report.is_favorite.is_(True), Report.owner_id.is_not(None))
    ):
        _carry(report, resource_type="report", url=f"/reports/{report.id}", icon="bar-chart")

    for search in session.scalars(
        _select(SavedSearch).where(
            SavedSearch.is_favorite.is_(True), SavedSearch.owner_id.is_not(None)
        )
    ):
        _carry(
            search,
            resource_type="saved_search",
            url=f"/search/saved/{search.id}",
            icon="search",
        )

    session.flush()
    return {"moved": moved, "already_bookmarked": already}


def sync_sessions(session) -> dict[str, int]:
    """Leave at most one current session per person, and only a live one (§41).

    `is_current` is derived from the *most recent live sign-in*, so this edits
    only a cached answer — the same justification `--sync-org` has for
    recounting a department's headcount. What it repairs: the seed marked the
    first five sessions of every user as current, so a person with three had
    three of them claiming to be the one they were using, and a revoked
    session could still be marked current.
    """
    from sqlalchemy import select as _select

    from src.core.clock import now
    from src.models.identity import UserSession

    moment = now()
    rows = _select(UserSession).where(UserSession.user_id.is_not(None))
    by_user: dict[Any, list[Any]] = {}
    for row in session.scalars(rows):
        by_user.setdefault(row.user_id, []).append(row)

    corrected = 0
    for sessions_of in by_user.values():
        live = [
            row
            for row in sessions_of
            if row.revoked_at is None and not (row.expires_at and row.expires_at <= moment)
        ]
        keeper = max(
            live,
            key=lambda row: row.last_seen_at or row.created_at,
            default=None,
        )
        for row in sessions_of:
            wanted = keeper is not None and row.id == keeper.id
            if row.is_current != wanted:
                row.is_current = wanted
                corrected += 1

    session.flush()
    return {"corrected": corrected, "people": len(by_user)}


def sync_imports(session) -> dict[str, int]:
    """Make every seeded import run describe a file that could exist (§29).

    The third content repair, and the one with the most to fix: the seeded
    runs had counts that could not all be true, mappings onto fields their
    target does not accept, more rows than an import may carry, and open
    drafts with nothing staged — so resuming one showed an empty wizard.
    Idempotent; a run that is already true is left alone.
    """
    return import_runs.materialise(session)


def sync_schema(engine) -> list[schema.Drift]:
    """Add the missing columns that can be added without losing data."""
    import src.models as models

    return schema.reconcile(engine, models.Base.metadata)


def drop_schema(engine) -> None:
    """Empty the database — including tables the model no longer declares.

    Reflected rather than model-driven. A model that has been *deleted* leaves
    its table behind, and that table's foreign keys still point at
    `organizations`; a metadata-only `drop_all` then fails on the parent it
    cannot drop and the database is left half-dropped. Not hypothetical —
    removing `SavedView` (§46) did exactly this to `--reset`.
    """
    from sqlalchemy import MetaData

    reflected = MetaData()
    reflected.reflect(bind=engine)
    reflected.drop_all(engine)


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

    # The derived tag arrays, here rather than in the caller: `verify` asserts
    # that they agree with the links, so a seed whose caller forgot the sync
    # would report itself inconsistent — and did, in `test_seed`. A generator
    # writes the truth; a derived value is derived once, by the one writer, and
    # the seed is a caller of it like any other.
    sync_tags(session)
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
    from src.services.explorer import resources as _resources
    from src.models.platform import ActivityEntry, AuditLog, BackgroundJob, ImportRun

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

    # An export must not claim a file. Every one of these was true on this
    # installation before `--sync-exports` existed: three SUCCEEDED exports
    # named `exports/JOB-00000N.csv` for bytes nobody had written, and their
    # `result.rows` was a progress counter over a `total_units` drawn at
    # random — so a "finished" export reported 184,203 of 250,000 rows in a
    # file that did not exist (§30).
    claiming = [
        row
        for row in session.scalars(select(BackgroundJob).where(BackgroundJob.kind == "EXPORT"))
    ]
    for row in claiming:
        payload = row.payload or {}
        result = row.result or {}
        if not payload.get("resource_type"):
            problems.append(f"{row.reference}: export names no dataset it can be run against")
        if (
            row.status == "SUCCEEDED"
            and not result.get("artifact")
            # A discarded or expired export legitimately has no file, and says
            # which. Without this the check called every one of them broken —
            # found by the end-to-end suite, which discards what it creates.
            and not result.get("artifact_removed")
        ):
            problems.append(f"{row.reference}: a finished export with no file")
        if row.status != "SUCCEEDED" and result.get("artifact"):
            problems.append(f"{row.reference}: an unfinished export claiming a file")
        if row.processed_units > row.total_units:
            problems.append(
                f"{row.reference}: {row.processed_units} of {row.total_units} units processed"
            )
        if row.status == "SUCCEEDED" and row.processed_units != row.total_units:
            problems.append(f"{row.reference}: finished without processing every unit")
        if row.status in ("FAILED", "RETRYING") and not row.failed_units:
            problems.append(f"{row.reference}: a failed export that failed nothing")

    # An import run must describe a file that could exist. Every one of these
    # was false on this installation before `/import` was built: the counts
    # did not add up, the mapping named fields the target does not have, the
    # row count was past what one import may carry, and an open draft held no
    # staged rows — so resuming one showed an empty wizard (§29).
    from src.core import importer as _importer
    from src.core import vocabulary

    for row in session.scalars(select(ImportRun)):
        resource = _resources().get(row.target_entity)
        if resource is None:
            problems.append(
                f"{row.reference}: imports into {row.target_entity}, which is not a dataset"
            )
            continue
        if resource.identity is None:
            problems.append(
                f"{row.reference}: imports into {row.target_entity}, which cannot be created"
            )

        columns = {str(item.get("name")) for item in (row.detected_columns or [])}
        mapping = row.column_mapping or {}
        stray_columns = sorted(set(mapping) - columns)
        if stray_columns:
            problems.append(
                f"{row.reference}: maps columns the file does not have: {stray_columns}"
            )
        stray_fields = sorted(set(mapping.values()) - set(resource.writable))
        if stray_fields:
            problems.append(
                f"{row.reference}: maps onto fields {row.target_entity} does not accept: "
                f"{stray_fields}"
            )
        if row.total_rows > _importer.MAX_ROWS:
            problems.append(
                f"{row.reference}: {row.total_rows} rows, past the {_importer.MAX_ROWS} an "
                "import may carry"
            )
        # Only once the rows have been checked — `IMPORT_COUNTED` names those
        # states. A DRAFT has been read and not yet validated, and a CANCELLED
        # run may have been abandoned from either side of that line.
        counted = row.valid_rows + row.invalid_rows + row.skipped_rows
        if (row.status in vocabulary.IMPORT_COUNTED or counted) and (
            counted != row.total_rows
        ):
            problems.append(
                f"{row.reference}: {row.valid_rows} valid + {row.invalid_rows} invalid + "
                f"{row.skipped_rows} skipped is not {row.total_rows} rows"
            )
        if row.imported_rows > row.valid_rows:
            problems.append(
                f"{row.reference}: imported {row.imported_rows} of {row.valid_rows} valid rows"
            )
        if row.status == "COMPLETED" and row.imported_rows != row.valid_rows:
            problems.append(
                f"{row.reference}: completed without importing every valid row"
            )
        if row.status in ("DRAFT", "VALIDATED"):
            staged = len(row.staged_rows or [])
            if not staged:
                problems.append(
                    f"{row.reference}: is open and holds no rows, so it cannot be resumed"
                )
            elif staged != row.total_rows:
                # An open run's total is the rows it holds. Two independent
                # numbers let a draft claim 400 rows and stage 60.
                problems.append(
                    f"{row.reference}: holds {staged} rows and claims {row.total_rows}"
                )
        if row.status == "VALIDATED" and row.valid_rows <= 0:
            # "Validated" has to mean there is something to import, or the
            # wizard offers an execute it will refuse (§76).
            problems.append(
                f"{row.reference}: is validated with no valid row in it"
            )
        if row.status not in ("DRAFT", "VALIDATED") and (row.staged_rows or []):
            problems.append(
                f"{row.reference}: has finished and still holds a copy of the file"
            )
        lines = set()
        for problem in row.errors or []:
            if "line" not in problem:
                problems.append(f"{row.reference}: an error with no line number")
                break
            lines.add(problem["line"])
        if len(lines) > max(row.invalid_rows, 0):
            # `invalid_rows` counts *lines*, so the report cannot name more of
            # them than the count admits to. It did: a repair rebuilt the
            # counts and left twelve problems describing seven bad rows.
            problems.append(
                f"{row.reference}: reports problems on {len(lines)} lines and counts "
                f"{row.invalid_rows} invalid"
            )

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

    # The `tags` array is a *derived* cache of `tag_links` with exactly one
    # writer (`services/tags._resync`). A derived column is only a decision
    # while something asserts it; two stores for one fact is what it becomes
    # otherwise, which is how 44 tagged tasks and 28 tag links came to
    # disagree. `--sync-tags` is the repair this reports.
    problems.extend(_tags_out_of_step(session))

    # A saved report whose definition the compiler would reject is a row that
    # looks fine in psql and fails the moment somebody opens `/reports`. Every
    # seeded report was one of these — the dimensions were drawn from a
    # literal list of column names no dataset declares — and nothing said so
    # until a screenshot showed "region cannot be grouped by".
    problems.extend(_unrunnable_reports(session))
    # And the same class of fault in the automations, for the same reason:
    # a rule that cannot compile its condition reports quiet rather than
    # broken, which is the one thing a monitor must never do (§49).
    problems.extend(_unrunnable_automations(session))
    # And a number that contradicts the directory it summarises: `headcount`
    # was drawn at random before the users existed, so Support stored 116 with
    # nobody assigned to it (§57).
    problems.extend(_headcount_drift(session))

    return problems


def _headcount_drift(session) -> list[str]:
    """Departments whose stored `headcount` disagrees with their people.

    Reported rather than tolerated because two numbers for one fact is the
    defect this whole codebase keeps finding, and the stored one is always the
    one that lies. `--sync-org` is the repair; `services/organizations`
    computes the count itself so the API is right either way.
    """
    from sqlalchemy import func, select

    from src.models.identity import Department, User

    actual = dict(
        session.execute(
            select(User.department_id, func.count())
            .where(User.department_id.is_not(None), User.deleted_at.is_(None))
            .group_by(User.department_id)
        ).all()
    )
    problems: list[str] = []
    for row in session.scalars(
        select(Department).where(Department.deleted_at.is_(None))
    ).all():
        real = int(actual.get(row.id, 0))
        if int(row.headcount or 0) != real:
            problems.append(
                f"department {row.name!r} says {row.headcount} people, has {real}"
            )
    return problems


def sync_flags(session) -> dict[str, int]:
    """Turn on every flag that hides something shipped (§27).

    The eighth repair, and the one that exists because of a real regression: a
    rollout percentage is how a team ships something *gradually*, and the seed
    was applying one to finished features. `dashboard-builder` came out
    disabled at five per cent, so `/dashboards` — a complete, tested page —
    was absent from the navigation of every demo persona, and `/import` was
    there for one in ten.

    An *edit*, like `sync_org` and `sync_health`, and safe for the same reason
    with one addition: it only ever turns a navigation flag **on**. Somebody
    who has deliberately switched one off has made a decision, and a repair
    that overruled it would be worse than the bug — so a flag that is already
    enabled at a hundred per cent is left exactly as it is.
    """
    from src.models.platform import FeatureFlag
    from src.seed import catalog

    rows = session.scalars(
        select(FeatureFlag).where(FeatureFlag.key.in_(sorted(catalog.NAVIGATION_FLAGS)))
    ).all()
    repaired = 0
    for row in rows:
        # A partial rollout on a shipped feature is the bug; a deliberate
        # `enabled=False` is a decision. Both end up hiding the page, so this
        # cannot tell them apart — and it repairs the rollout either way while
        # leaving the switch itself alone when somebody has turned it off.
        if row.enabled and int(row.rollout_percentage or 0) >= 100:
            continue
        row.rollout_percentage = 100
        row.target_user_ids = None
        row.target_roles = None
        if not row.enabled:
            row.enabled = True
        repaired += 1
    return {"repaired": repaired, "checked": len(rows)}


def sync_preferences(session) -> dict[str, int]:
    """Fill in preference keys an account's stored blob predates (§40).

    The ninth repair, and a sibling of `sync_settings`: the declaration in
    `services/me.py` gains a key — a pop-up placement, a mail preview side —
    and every account seeded before it has a blob without that key. Reading
    falls back to the default, so nothing breaks; *writing* one section of a
    blob that has never held the key is where a half-populated preference comes
    from, and the preferences screen then renders a control with no value.

    Additive only, and that is what makes it safe on a live database: a key
    already present keeps whatever value somebody chose, whether or not it
    matches the default. The single exception is `sidebar_collapsed`, seeded
    `True` for a quarter of the demo personas — signing in to a rail of
    unlabelled icons reads as broken navigation rather than as a preference,
    so it is reset the way `sync_flags` resets a rollout on a shipped feature.

    Idempotent, so it can run on every deploy.
    """
    from src.models.identity import User
    from src.services.me import PREFERENCE_DEFAULTS

    filled = reset = 0
    for row in session.scalars(select(User)).all():
        stored = dict(row.preferences or {})
        changed = False
        for section, defaults in PREFERENCE_DEFAULTS.items():
            block = dict(stored.get(section) or {})
            for key, default in defaults.items():
                if key not in block:
                    block[key] = deepcopy(default)
                    changed = True
            if block != (stored.get(section) or {}):
                stored[section] = block
        if stored.get("appearance", {}).get("sidebar_collapsed"):
            stored["appearance"]["sidebar_collapsed"] = False
            reset += 1
            changed = True
        if changed:
            # Reassigned rather than mutated: the column is JSON, and SQLAlchemy
            # does not see an in-place edit of a dict it handed out.
            row.preferences = stored
            filled += 1
    return {"filled": filled, "expanded": reset}


def sync_health(session) -> dict[str, int]:
    """Give every monitored service a month of history to draw.

    The seventh repair, and an *edit* like `sync_org` — safe for the same
    reason: a health history is a recording, not a decision anybody made.

    The column was seeded with twenty-four hourly points, which is exactly one
    day, so `/admin/health`'s 7d and 30d windows drew empty charts on any
    database seeded before the page could ask for them. Rewritten rather than
    appended to, because a series stitched from two generators has a visible
    seam at the join and somebody would read it as an incident.
    """
    from src.models.platform import ServiceHealth
    from src.seed.operations import _health_series

    # Anchored on *now* rather than on the original seed's moment: a history
    # that ends a fortnight ago draws a chart with nothing in the window
    # anybody actually looks at.
    anchor = now()
    rng = Rng(int(anchor.timestamp() * 1000), anchor)
    rows = session.scalars(select(ServiceHealth)).all()
    extended = 0
    points = 0
    for row in rows:
        if len(row.history or []) >= 200:
            continue
        series = _health_series(rng.derive(f"health:{row.key}"), anchor)
        row.history = series
        extended += 1
        points = len(series)
    return {"extended": extended, "points": points}


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


def _tags_out_of_step(session) -> list[str]:
    """Where a record's `tags` array disagrees with its links.

    Compared as *sets of names*, because that is what the column is a cache
    of. Reported per dataset with a count rather than per record: "17 tasks
    disagree" is what somebody acts on, and seventeen identical lines are what
    they scroll past.
    """
    from sqlalchemy import func, select as _select

    from src.models.content import Tag, TagLink
    from src.services.explorer import resources as _resources

    problems: list[str] = []

    links: dict[tuple[str, str], set[str]] = {}
    for resource_type, resource_id, name in session.execute(
        _select(TagLink.resource_type, TagLink.resource_id, Tag.name).join(
            Tag, Tag.id == TagLink.tag_id
        )
    ).all():
        links.setdefault((str(resource_type), str(resource_id)), set()).add(str(name))

    for key, resource in _resources().items():
        model = resource.model
        if not hasattr(model, "tags"):
            continue
        wrong = 0
        for row in session.scalars(_select(model)).unique().all():
            stored = set(row.tags or [])
            wanted = links.get((key, str(row.id)), set())
            if stored != wanted:
                wrong += 1
        if wrong:
            problems.append(
                f"{key}.tags: {wrong} records disagree with their tag links — "
                "run `python -m src.seed --sync-tags`"
            )

    # And the counts the tag manager sorts by.
    drifted = 0
    for tag in session.scalars(_select(Tag)).all():
        wanted = int(
            session.scalar(
                _select(func.count()).select_from(TagLink).where(TagLink.tag_id == tag.id)
            )
            or 0
        )
        if int(tag.usage_count or 0) != wanted:
            drifted += 1
    if drifted:
        problems.append(
            f"tags.usage_count: {drifted} tags disagree with their links — "
            "run `python -m src.seed --sync-tags`"
        )
    return problems


def _unrunnable_reports(session) -> list[str]:
    """Reports naming a column or an aggregation the compiler does not know.

    Checked against the same declarations the analysis catalogue publishes,
    which is what the compiler itself resolves against — so this cannot drift
    from the rule it is testing.
    """
    from sqlalchemy import select as _select

    from src.models.personal import Report
    from src.services.analysis import AGGREGATIONS, DIMENSION_KINDS, MEASURE_KINDS
    from src.services.explorer import resources

    catalogue = resources()
    problems: list[str] = []
    counts: dict[str, int] = {}

    for row in session.scalars(_select(Report).where(Report.deleted_at.is_(None))):
        resource = catalogue.get(row.resource_type)
        if resource is None:
            counts[f"names dataset {row.resource_type}, which does not exist"] = (
                counts.get(f"names dataset {row.resource_type}, which does not exist", 0) + 1
            )
            continue

        groupable = {
            field.name
            for field in resource.fields.fields
            if field.kind in DIMENSION_KINDS and field.filterable
        }
        measurable = {
            field.name for field in resource.fields.fields if field.kind in MEASURE_KINDS
        }

        faults: list[str] = []
        if len(row.dimensions or []) > 2:
            faults.append("groups by more than two columns")
        for entry in row.dimensions or []:
            name = str(entry).partition(":")[0]
            if name not in groupable:
                faults.append(f"cannot group {row.resource_type} by {name}")
        for entry in row.metrics or []:
            aggregation, _, field = str(entry).partition(":")
            if aggregation not in AGGREGATIONS:
                faults.append(f"{aggregation} is not an aggregation")
            elif aggregation != "count" and field not in measurable:
                faults.append(f"cannot {aggregation} {row.resource_type}.{field or '(nothing)'}")

        for fault in faults:
            counts[fault] = counts.get(fault, 0) + 1

    for fault, count in sorted(counts.items(), key=lambda pair: -pair[1]):
        problems.append(f"{count} report(s) {fault}")
    return problems


def sync_reports(session) -> dict[str, int]:
    """Rewrite saved reports whose definition the compiler would reject.

    Not part of a seed run. This is what an *existing* database needs: every
    report seeded before the generator derived its columns from the resource
    declarations names a column or an aggregation that does not exist, and
    seeding refuses to touch a populated database — rightly, but that leaves
    the rows there.

    The repair is the smallest one that makes the question answerable: keep the
    groupings and measures that are valid, drop the rest, and fall back to the
    dataset's first groupable column and a row count if nothing survives. A
    report whose *name* says "by region" and whose dataset has no region is
    going to read oddly either way; a report that errors reads worse, and the
    name is a person's words to change, not this function's.

    Idempotent, so it can be run on every deploy.
    """
    from sqlalchemy import select as _select

    from src.models.personal import Report
    from src.services.analysis import AGGREGATIONS, DIMENSION_KINDS, MEASURE_KINDS
    from src.services.explorer import resources

    catalogue = resources()
    repaired = 0
    orphaned = 0

    for row in session.scalars(_select(Report).where(Report.deleted_at.is_(None))):
        resource = catalogue.get(row.resource_type)
        if resource is None:
            # Nothing to repair it *to*: the dataset it reports on is gone.
            orphaned += 1
            continue

        groupable = [
            field.name
            for field in resource.fields.fields
            if field.kind in DIMENSION_KINDS and field.filterable and field.kind != "datetime"
        ]
        measurable = {
            field.name for field in resource.fields.fields if field.kind in MEASURE_KINDS
        }

        dimensions = [
            str(entry)
            for entry in (row.dimensions or [])
            if str(entry).partition(":")[0] in groupable
        ][:2]
        if not dimensions and groupable:
            dimensions = [groupable[0]]

        metrics = []
        for entry in row.metrics or []:
            aggregation, _, field = str(entry).partition(":")
            if aggregation not in AGGREGATIONS:
                continue
            if aggregation == "count":
                metrics.append("count")
            elif field in measurable:
                metrics.append(f"{aggregation}:{field}")
        if not metrics:
            metrics = ["count"]

        group_by = dimensions[0].partition(":")[0] if dimensions else None
        sort = metrics[0].partition(":")[0]
        if (
            list(row.dimensions or []) == dimensions
            and list(row.metrics or []) == metrics
            and row.group_by == group_by
            and row.sort == sort
        ):
            continue

        # Reassigned rather than mutated: an ARRAY column changed in place is
        # not seen as dirty by SQLAlchemy, and the UPDATE never happens.
        row.dimensions = dimensions
        row.metrics = metrics
        row.group_by = group_by
        row.sort = sort
        repaired += 1

    return {"repaired": repaired, "orphaned": orphaned}


def _unrunnable_automations(session) -> list[str]:
    """Automations the engine could not evaluate or could not act on.

    The same check the *reports* one is: rules seeded before the generator
    derived them from the declarations watch datasets the explorer does not
    have, compile conditions against fields that are not there, and carry
    actions in a shape `services/workflows` never reads. A rule like that
    reports success by never firing, which is the worst failure a monitoring
    feature has — so it is checked, and named.
    """
    from sqlalchemy import select as _select

    from src.core.errors import ValidationError
    from src.core.rules import compile_tree
    from src.models.platform import AlertRule
    from src.services.explorer import resources
    from src.services.workflows import ACTIONS

    catalogue = resources()
    counts: dict[str, int] = {}

    # Enabled rules only. A paused rule cannot fire, so an unrunnable one is a
    # recorded outcome rather than a fault — `--sync-automations` pauses the
    # rules whose dataset is gone, and a check that kept reporting them after
    # the repair is a check nobody can ever get to green.
    live = _select(AlertRule).where(
        AlertRule.deleted_at.is_(None), AlertRule.enabled.is_(True)
    )
    for row in session.scalars(live):
        resource = catalogue.get(row.resource_type)
        if resource is None:
            counts[f"watch dataset {row.resource_type}, which does not exist"] = (
                counts.get(f"watch dataset {row.resource_type}, which does not exist", 0) + 1
            )
            continue
        try:
            if compile_tree(row.condition_tree, resource.fields) is None:
                counts["have no condition, so they match nothing"] = (
                    counts.get("have no condition, so they match nothing", 0) + 1
                )
        except ValidationError as error:
            key = f"cannot compile their condition ({error})"
            counts[key] = counts.get(key, 0) + 1
        kinds = {
            str(item.get("kind") or item.get("type") or "").upper()
            for item in (row.actions or [])
            if isinstance(item, dict)
        }
        if not kinds or not kinds & set(ACTIONS):
            counts["carry no action this platform can run"] = (
                counts.get("carry no action this platform can run", 0) + 1
            )

    return [
        f"{count} automation(s) {fault}"
        for fault, count in sorted(counts.items(), key=lambda pair: -pair[1])
    ]


def sync_automations(session) -> dict[str, int]:
    """Make existing automations runnable, without a destructive reseed.

    The report repair's sibling, for the same reason and with the same shape:
    the rules already in a populated database were written before the generator
    derived them, and seeding refuses to touch populated data. Three repairs,
    each the smallest one that makes the rule mean something:

      * a rule watching a dataset that does not exist is **paused**. There is
        nothing to repair it *to*, and a rule left enabled against a missing
        dataset is a monitor that reports quiet because it cannot look;
      * a condition that will not compile is replaced by one derived from the
        dataset's own state field — the same derivation the seed uses;
      * actions are kept where they are executable and dropped where they are
        not, falling back to notifying the rule's owner, because a rule with no
        actions matches, records fires and does nothing.

    Idempotent, so it can run on every deploy.
    """
    from sqlalchemy import select as _select

    from src.core.errors import ValidationError
    from src.core.rules import compile_tree, describe_tree
    from src.models.platform import AlertRule
    from src.services.explorer import resources

    catalogue = resources()
    repaired = 0
    paused = 0

    for row in session.scalars(_select(AlertRule).where(AlertRule.deleted_at.is_(None))):
        resource = catalogue.get(row.resource_type)
        if resource is None:
            if row.enabled:
                row.enabled = False
                paused += 1
            continue

        changed = False

        try:
            compiled = compile_tree(row.condition_tree, resource.fields)
        except ValidationError:
            compiled = None
        if compiled is None:
            tree = _derived_condition(resource)
            if tree is None:
                # No state to watch: pausing is the only honest outcome.
                if row.enabled:
                    row.enabled = False
                    paused += 1
                continue
            row.condition_tree = tree
            row.condition_text = describe_tree(tree, resource.fields)
            changed = True

        actions = [
            action
            for item in (row.actions or [])
            if isinstance(item, dict)
            and (action := _repaired_action(item)) is not None
        ]
        if not actions:
            actions = [
                {
                    "kind": "NOTIFY",
                    "recipients": {"user_ids": [], "role": "", "owner": True},
                    "title": "{rule}: {record}",
                }
            ]
        if actions != list(row.actions or []):
            # Reassigned rather than mutated: a JSONB column changed in place
            # is not seen as dirty by SQLAlchemy and the UPDATE never happens.
            row.actions = actions
            changed = True

        if changed:
            repaired += 1

    return {"repaired": repaired, "paused": paused}


def _derived_condition(resource) -> dict[str, Any] | None:
    """A condition on a dataset's own state field, or None if it has none.

    Deliberately the same shape the seed builds, so a repaired rule is
    indistinguishable from a freshly seeded one.
    """
    for name in (resource.status_field, "priority", "status"):
        field = resource.fields.by_name.get(name) if name else None
        if field is not None and field.kind == "enum" and field.filterable and field.choices:
            return {
                "type": "group",
                "conjunction": "AND",
                "children1": {
                    "a": {
                        "type": "rule",
                        "properties": {
                            "field": field.name,
                            "operator": "select_any_in",
                            "value": [list(field.choices[:2])],
                        },
                    }
                },
            }
    return None


def _repaired_action(item: dict[str, Any]) -> dict[str, Any] | None:
    """One action in the shape the engine reads, or None if it cannot be.

    `type` → `kind` and an audience word → a recipient declaration: the old
    seed wrote `{"type": "NOTIFY", "audience": "OWNERS"}`, which the engine
    reads as an action addressed to nobody.
    """
    from src.services.workflows import ACTIONS

    kind = str(item.get("kind") or item.get("type") or "").upper()
    action = ACTIONS.get(kind)
    if action is None:
        return None

    repaired: dict[str, Any] = {"kind": kind}
    for name in ("title", "body", "subject", "template", "priority", "assignee_id"):
        if item.get(name):
            repaired[name] = item[name]

    if "recipients" in action.needs:
        existing = item.get("recipients")
        if isinstance(existing, dict) and (
            existing.get("user_ids") or existing.get("role") or existing.get("owner")
        ):
            repaired["recipients"] = existing
        else:
            # `audience: OWNERS` and its friends meant the rule's owner.
            repaired["recipients"] = {"user_ids": [], "role": "", "owner": True}

    if "url" in action.needs:
        url = str(item.get("url") or "")
        if not url.startswith(("http://", "https://")):
            return None
        repaired["url"] = url

    return repaired


def sync_mailboxes(session) -> dict[str, int]:
    """Give each demo persona an inbox worth opening, without reseeding.

    The third of these repairs, and the same shape as the other two: targeted,
    idempotent, and additive. It exists because the mailbox generator's folder
    draw is random and its own docstring promises something it did not always
    deliver — at the small scale the *administrator*, the account everybody
    signs in as first, ended up with two threads and neither in the inbox. An
    empty inbox on a demo reads as a broken feature.

    Idempotent because it counts what is already there: run twice and the
    second run adds nothing. Additive because it only inserts — a mailbox
    somebody has been reading is not touched, and mail they filed elsewhere
    stays filed.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.core.clock import now
    from src.models.content import EmailThread
    from src.models.identity import User
    from src.seed.content import GUARANTEED_INBOX, inbox_thread
    from src.seed.support import Rng

    anchor = now()
    # Seeded from the clock, not from a constant. The *seed* is reproducible on
    # purpose; a repair writing into a live database must not be — a fixed seed
    # regenerates the same UUIDs, so a second run that finds one persona short
    # collides with the rows the first run wrote for another.
    rng = Rng(int(anchor.timestamp() * 1000), anchor).derive("mailbox-topup")
    personas = session.scalars(
        _select(User).where(
            User.username.in_(("admin", "manager", "operator", "analyst", "user")),
            User.deleted_at.is_(None),
        )
    ).all()

    counted = dict(
        session.execute(
            _select(EmailThread.owner_id, func.count())
            .where(
                EmailThread.folder == "INBOX",
                EmailThread.deleted_at.is_(None),
            )
            .group_by(EmailThread.owner_id)
        ).all()
    )

    added = 0
    for owner in personas:
        colleagues = session.scalars(
            _select(User)
            .where(
                User.organization_id == owner.organization_id,
                User.id != owner.id,
                User.deleted_at.is_(None),
            )
            .limit(12)
        ).all()
        missing = max(0, GUARANTEED_INBOX - int(counted.get(owner.id, 0)))
        for index in range(missing):
            added += 1
            sender = rng.pick(colleagues) if colleagues else owner
            thread, message = inbox_thread(rng, owner, sender, anchor, index, added)
            session.add(thread)
            session.add(message)

    session.flush()
    return {"added": added, "personas": len(personas)}


def sync_jobs(session) -> dict[str, int]:
    """Top every job status up to `GUARANTEED_PER_STATUS`, additively.

    The fifth of these repairs, and the one to run when the end-to-end suite
    starts complaining that nothing is queued. `JOB_STATUS` is what
    `/admin/jobs` builds its filters from, and RETRYING is weighted at 0.04 —
    so at the small scale the draw leaves it empty about half the time and the
    console offers a filter that can never match anything (§76). The suite then
    *spends* these: it retries a job and cancels another, and a retry spends an
    attempt irreversibly, so the states drain with use.

    One invariant: `GUARANTEED_PER_STATUS` jobs per status that the console can
    actually *retry*. Stated that way because it subsumes the row count — a
    retryable job is a row — and because the two things it guarantees are what
    the console and the suite each need: no filter that can never match, and
    something left to retry. Counting rows alone kept finding five cancelled
    jobs and never noticing every one had spent its attempts; then counting
    `attempt < max_attempts` alone counted three *exports*, which this console
    does not retry at all (§30). Both times the repair reported success and
    changed nothing, which is the failure mode to watch for here: the count has
    to be of the same thing the guard checks.

    Additive by construction: it counts what is there and inserts only what is
    short. Never edits an existing job, because a job's status and its attempt
    count are a *record of what happened*, and rewriting either would be the
    repair telling a lie about history.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.core import vocabulary
    from src.core.clock import now
    from src.core.naming import sequence_of
    from src.models.identity import User
    from src.models.platform import BackgroundJob, ScheduledTask
    from src.seed.operations import background_job
    from src.seed.support import Rng
    from src.services.jobs import NOT_OURS_TO_RETRY

    anchor = now()
    # Seeded from the clock for the same reason `sync_mailboxes` is: a fixed
    # seed regenerates the same UUIDs, so a second run collides with the rows
    # the first one wrote.
    rng = Rng(int(anchor.timestamp() * 1000), anchor).derive("jobs-topup")

    from src.seed.operations import GUARANTEED_PER_STATUS

    # Counted two ways, because the console needs two different things and the
    # first version of this only guaranteed the first.
    #
    # *Rows* per status is what the filters need: a status with none is a
    # filter that can never match anything (§76).
    #
    # *Retryable* rows — `attempt < max_attempts` — is what the suite needs,
    # and it is the one that ran dry. A retry spends an attempt irreversibly,
    # so topping up by row count alone kept finding five cancelled jobs and
    # never noticed that none of them could be retried any more. The end-to-end
    # spec then failed on its own guard, which is at least the right failure.
    counted = dict(
        session.execute(
            _select(BackgroundJob.status, func.count()).group_by(BackgroundJob.status)
        ).all()
    )
    fresh = dict(
        session.execute(
            _select(BackgroundJob.status, func.count())
            .where(
                BackgroundJob.attempt < BackgroundJob.max_attempts,
                # The console's own rule, not a looser one. `can_retry` also
                # refuses a kind another screen owns — an export is
                # re-requested on `/exports`, not retried here (§30) — and
                # counting those as "fresh" is how the repair came to report
                # "0 added — every status already has the guaranteed minimum"
                # while three of the queue's four retryable-looking cancelled
                # jobs were exports the console would not touch. A repair that
                # measures a different thing from the guard it exists to
                # satisfy is a repair that reports success and changes nothing.
                BackgroundJob.kind.notin_(tuple(NOT_OURS_TO_RETRY)),
            )
            .group_by(BackgroundJob.status)
        ).all()
    )
    # One invariant, stated once: `GUARANTEED_PER_STATUS` jobs per status that
    # are still *within their attempts*. It subsumes the row count, since a
    # fresh job is a row — and guaranteeing only one actionable job made the
    # suite green for exactly one run per repair, because each run spends it.
    wanted = [
        (
            status,
            max(
                GUARANTEED_PER_STATUS - int(counted.get(status, 0)),
                GUARANTEED_PER_STATUS - int(fresh.get(status, 0)),
            ),
        )
        for status in vocabulary.JOB_STATUS
    ]
    missing = [(status, short) for status, short in wanted if short > 0]
    if not missing:
        return {"added": 0, "statuses": 0}

    users = session.scalars(_select(User).where(User.deleted_at.is_(None)).limit(50)).all()
    tasks = session.scalars(_select(ScheduledTask).limit(20)).all()
    # Numbered past the highest existing reference — the *reference*, not the
    # row count, which is what this used to read. `reference` is unique in the
    # schema, and a count is only coincidentally related to the highest number
    # in it: exports carry their own `EXP-` prefix (§30) and their records can
    # be removed, so the count can *fall* while `JOB-001034` still exists.
    # `MAX(reference)` per prefix is what `core/naming` prescribes and what
    # every other reference generator in the platform does.
    #
    # Both prefixes, because `background_job` draws its kind and an EXPORT one
    # is numbered `EXP-` from the same index.
    highest = max(
        sequence_of(
            session.scalar(
                _select(func.max(BackgroundJob.reference)).where(
                    BackgroundJob.reference.like(f"{prefix}-%")
                )
            ),
            prefix=prefix,
        )
        for prefix in ("JOB", "EXP")
    )

    offset = 0
    for status, short in missing:
        for _ in range(short):
            session.add(
                background_job(
                    rng,
                    index=highest + offset + 1000,
                    status=status,
                    users=list(users),
                    scheduled_tasks=list(tasks),
                    # Below `max_attempts`, so what this adds is something the
                    # console can actually act on.
                    fresh=True,
                )
            )
            offset += 1

    return {"added": offset, "statuses": len(missing)}


def sync_settings(session) -> dict[str, int]:
    """Bring each setting's *declaration* up to date, keeping chosen values.

    The fourth of these repairs, and the one an ordinary deploy needs: the
    catalogue gains a setting, or an existing one gains a type and a range, and
    seeding refuses to touch a populated database. Without this the demo kept
    twenty settings declared as `string` with no options — so the settings
    screen rendered every one as a text box and the declared type was
    decoration.

    What it writes: the label, description, type, options, secrecy and the
    **default**. What it leaves alone: the `value` somebody chose — with one
    exception. When a type or its choices change, a stored value can stop being
    valid for its own declaration (`"25"` as a string is not `25` in a list of
    integers), and a setting the editor refuses is a screen reporting its own
    data as invalid. Those are reset to the new default, and counted
    separately so the output says how many.

    Idempotent, so it can run on every deploy.
    """
    from sqlalchemy import select as _select

    from src.models.platform import SystemSetting
    from src.seed import catalog

    added = updated = reset = 0
    for key, category, label, value_type, default, description, options in (
        catalog.SYSTEM_SETTINGS
    ):
        row = session.scalar(_select(SystemSetting).where(SystemSetting.key == key))
        if row is None:
            session.add(
                SystemSetting(
                    key=key,
                    category=category,
                    label=label,
                    description=description,
                    value={"value": default},
                    default_value={"value": default},
                    value_type=value_type,
                    options=options or None,
                    is_secret=bool(options.get("secret")),
                    requires_restart=bool(options.get("restart")),
                )
            )
            added += 1
            continue

        changed = False
        for attribute, value in (
            ("category", category),
            ("label", label),
            ("description", description),
            ("value_type", value_type),
            ("options", options or None),
            ("is_secret", bool(options.get("secret"))),
            ("requires_restart", bool(options.get("restart"))),
            ("default_value", {"value": default}),
        ):
            if getattr(row, attribute) != value:
                setattr(row, attribute, value)
                changed = True

        if not _fits(row, options, value_type):
            row.value = {"value": default}
            reset += 1
            changed = True
        if changed:
            updated += 1

    session.flush()
    return {"added": added, "updated": updated, "reset": reset}


def _fits(row, options: dict, value_type: str) -> bool:
    """Whether a stored value is still valid for its own declaration."""
    current = row.value.get("value") if isinstance(row.value, dict) else row.value
    if value_type == "boolean":
        return isinstance(current, bool)
    if value_type in ("integer", "duration"):
        if not isinstance(current, int) or isinstance(current, bool):
            return False
        low, high = options.get("minimum"), options.get("maximum")
        if low is not None and current < int(low):
            return False
        return not (high is not None and current > int(high))
    if value_type == "choice":
        choices = options.get("choices") or []
        return not choices or current in choices
    return True


def sync_roles(session) -> dict[str, list[str]]:
    """Give the built-in roles every permission their declaration names.

    A permission that exists in code and in no role's row can be granted by
    nobody: `core/auth._permissions_for` reads the database, so adding one to
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
