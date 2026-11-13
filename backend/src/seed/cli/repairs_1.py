"""Seed repair commands: --sync-schema … --sync-imports (idempotent, for a database seeded before a feature)."""

from __future__ import annotations

from framework.commons.logger import logger as log  # noqa: F401

from src.core.db import get_engine, session_scope  # noqa: F401
from src.seed import runner  # noqa: F401
from src.seed.world import SCALES  # noqa: F401


def sync_schema(args, engine) -> int:
    """--sync-schema."""
    # Additive only. A column that cannot be added without deciding what
    # existing rows get is reported rather than guessed at.
    added = runner.sync_schema(engine)
    for item in added:
        print(f"  + {item.table}.{item.column}")
    blocked = runner.schema_drift(engine)
    for item in blocked:
        print(f"  ! {item}")
    if not added:
        print("database already matches the model")
    else:
        tables = sum(1 for item in added if not item.column)
        columns = len(added) - tables
        parts = [f"{tables} table(s) created"] if tables else []
        parts += [f"{columns} column(s) added"] if columns else []
        print(", ".join(parts))
    if not blocked:
        # A database whose schema now matches the models is a database at
        # the latest revision, and saying so is what stops the first
        # `make migrate` on it from trying to create every table again.
        # Only ever *recorded*, never assumed: `stamp_head` refuses a
        # database that already carries a revision.
        stamped = runner.stamp_head(engine)
        if stamped:
            print(f"recorded schema revision {stamped}")
    return 1 if blocked else 0


def sync_analytics(args, engine) -> int:
    """--sync-analytics."""
    # Records & analytics (§12, §13, §17, §22, §25) for a database seeded
    # before them: idempotent — each part adds only what is missing.
    from src.seed import records_analytics

    with session_scope() as session:
        result = records_analytics.populate(session)
    print(", ".join(f"{count} {name.replace('_', ' ')}" for name, count in result.items()))
    return 0


def sync_workflows(args, engine) -> int:
    """--sync-workflows."""
    # The visual workflow builder (§49) for a database seeded before it.
    from src.seed import workflows

    with session_scope() as session:
        result = workflows.populate(session)
    print(", ".join(f"{count} {name}" for name, count in result.items()))
    return 0


def sync_developers(args, engine) -> int:
    """--sync-developers."""
    from src.seed import developers as feature_seed

    with session_scope() as session:
        result = feature_seed.populate(session)
    print(", ".join(f"{count} {name.replace('_', ' ')}" for name, count in result.items()))
    return 0


def sync_onboarding(args, engine) -> int:
    """--sync-onboarding."""
    from src.seed import onboarding as feature_seed

    with session_scope() as session:
        result = feature_seed.populate(session)
    print(", ".join(f"{count} {name.replace('_', ' ')}" for name, count in result.items()))
    return 0


def sync_planning(args, engine) -> int:
    """--sync-planning."""
    # Work planning (§18) for a database seeded before it existed:
    # idempotent — the structure is added once, the fill-ins only touch
    # what is empty.
    from src.seed import planning

    with session_scope() as session:
        result = planning.populate(session)
    print(", ".join(f"{count} {name.replace('_', ' ')}" for name, count in result.items()))
    return 0


def sync_approvals(args, engine) -> int:
    """--sync-approvals, --sync-time, --sync-sla, --sync-forms."""
    # Time & decisions for a database seeded before it existed. Additive and
    # idempotent: each part is skipped when its rows are already there.
    from src.seed import decisions

    with session_scope() as session:
        for flag, step in (("sync_sla", decisions.populate_sla),
                           ("sync_approvals", decisions.populate_approvals),
                           ("sync_time", decisions.populate_time),
                           ("sync_forms", decisions.populate_forms)):
            if getattr(args, flag):
                result = step(session)
                print(f"{flag[5:]}: " + ", ".join(f"{count} {name}" for name, count in result.items()))
    return 0


def sync_files(args, engine) -> int:
    """--sync-files."""
    # A file manager whose every download fails is not a demonstration of
    # a file manager. Idempotent, so this also repairs a database seeded
    # before object storage existed.
    with session_scope() as session:
        result = runner.sync_files(session)
    print(
        f"{result['written']} objects written "
        f"({result['upgraded']} placeholder image(s) replaced), "
        f"{result['already_present']} already there"
    )
    return 0


def sync_exports(args, engine) -> int:
    """--sync-exports."""
    # A seeded export used to claim `{"rows": 184203, "artifact": …}` for a
    # file nobody had written. This produces the file and makes the counts
    # describe it. Idempotent.
    with session_scope() as session:
        result = runner.sync_exports(session)
    print(
        f"{result['written']} export files written "
        f"({result['guaranteed']} for personas who had none), "
        f"{result['corrected']} row(s) corrected, "
        f"{result['renamed']} renamed, "
        f"{result['already_present']} already there"
    )
    if result["unreadable"]:
        print(f"  ! {result['unreadable']} export(s) name a query that cannot be read")
    return 0


def sync_imports(args, engine) -> int:
    """--sync-imports."""
    # A seeded import run used to claim counts that could not all be true
    # and a mapping onto fields its target does not have. Idempotent.
    with session_scope() as session:
        result = runner.sync_imports(session)
    print(
        f"{result['repaired']} import run(s) repaired "
        f"({result['staged']} hold their file, {result['cleared']} error lists rebuilt), "
        f"{result['already_true']} already true"
    )
    if result["unreadable"]:
        print(f"  ! {result['unreadable']} run(s) name a dataset that cannot be imported into")
    return 0
