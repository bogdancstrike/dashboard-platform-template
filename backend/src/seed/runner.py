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

from sqlalchemy import select

from src.config import Config
from src.core.clock import now
from src.seed import blobs, business, content, identity, operations, personal, schema
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
    "saved_views", "dashboards", "dashboard_widgets", "reports", "favorites",
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
    """
    import src.models as models

    models.Base.metadata.create_all(engine)

    remaining = schema_drift(engine)
    if remaining:
        from framework.commons.logger import logger as log

        log.warning(
            "the database is behind the model: "
            + "; ".join(str(item) for item in remaining)
            + " — run 'python -m src.seed --sync-schema'",
            "yellow",
        )


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


def sync_schema(engine) -> list[schema.Drift]:
    """Add the missing columns that can be added without losing data."""
    import src.models as models

    return schema.reconcile(engine, models.Base.metadata)


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

    # A scope the sharing model cannot express is a row nobody but its owner
    # can see and nobody at all can edit — and it fails silently, because
    # `sharing.visibility` simply has no branch for it. Reported here because
    # `--check` is where a database says what is wrong with it.
    from src.core.sharing import SCOPES
    from src.models.personal import Report, SavedView

    for label, model in (
        ("dashboards", Dashboard), ("reports", Report),
        ("saved views", SavedView), ("saved searches", SavedSearch),
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
