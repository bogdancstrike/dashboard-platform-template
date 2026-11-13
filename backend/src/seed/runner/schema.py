"""Bootstrapping, stamping, comparing and dropping the schema."""

from __future__ import annotations

from pathlib import Path

from src.seed import schema

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

    root = Path(__file__).resolve().parents[3]
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
