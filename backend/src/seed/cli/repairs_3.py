"""Seed repair commands: --sync-preferences … --sync-settings (idempotent, for a database seeded before a feature)."""

from __future__ import annotations

from framework.commons.logger import logger as log  # noqa: F401

from src.core.db import get_engine, session_scope  # noqa: F401
from src.seed import runner  # noqa: F401
from src.seed.world import SCALES  # noqa: F401


def sync_preferences(args, engine) -> int:
    """--sync-preferences."""
    # The declaration in `services/me.py` gains a key and every account
    # seeded before it has a blob without one (§40). Additive, except the
    # seeded collapsed sidebar — a rail of unlabelled icons on first sign-in
    # reads as broken navigation, not as somebody's preference.
    with session_scope() as session:
        result = runner.sync_preferences(session)
    print(
        f"{result['filled']} accounts filled in, {result['expanded']} sidebars expanded"
        if result["filled"]
        else "every account's preferences are already complete"
    )
    return 0


def sync_dashboards(args, engine) -> int:
    """--sync-dashboards."""
    from src.seed import dashboard_periods

    with session_scope() as session:
        result = dashboard_periods.sync(session)
    print(f"{result['dashboards']} dashboard periods and {result['widgets']} widget periods reset")
    return 0


def sync_report_documents(args, engine) -> int:
    """--sync-report-documents."""
    # Additive and by owner + name: a document already there is left alone.
    from src.seed import report_documents as report_documents_seed

    with session_scope() as session:
        result = report_documents_seed.seed(session)
    print(f"{result['documents']} report documents added")
    return 0


def sync_folders(args, engine) -> int:
    """--sync-folders."""
    from src.seed.content import dedupe_folders

    with session_scope() as session:
        result = dedupe_folders(session)
    print(f"{result['renamed']} folders renamed")
    return 0


def sync_insights(args, engine) -> int:
    """--sync-insights."""
    from src.seed import insights as insights_seed

    with session_scope() as session:
        result = insights_seed.seed(session)
    print(f"{result['insights']} insights and {result['widgets']} dashboard widget added")
    return 0


def sync_knowledge(args, engine) -> int:
    """--sync-knowledge."""
    # Additive: a collection already there (seeded or anybody's) is left alone.
    from src.seed import knowledge as knowledge_seed

    with session_scope() as session:
        result = knowledge_seed.seed(session)
    print(f"{result['collections']} collections and {result['documents']} documents added")
    return 0


def sync_assistant(args, engine) -> int:
    """--sync-assistant."""
    # Additive: a persona's conversation with the same title is left alone.
    from src.seed import assistant as assistant_seed

    with session_scope() as session:
        result = assistant_seed.seed(session)
    print(f"{result['conversations']} assistant conversations and {result['messages']} messages added")
    return 0


def sync_collab(args, engine) -> int:
    """--sync-collab."""
    # Additive and by name: a channel, space or page somebody already has
    # (or has since edited) is left alone, so this is safe to run again.
    from src.seed import collab

    runner.bootstrap_schema(engine)
    with session_scope() as session:
        result = collab.seed(session)
    print(", ".join(f"{count} {name}" for name, count in result.items()) + " added")
    return 0


def sync_health(args, engine) -> int:
    """--sync-health."""
    # The history column was seeded with twenty-four points, which is one
    # day — so the 7d and 30d windows on `/admin/health` drew nothing on a
    # database seeded before this. An *edit*, and safe for the same reason
    # `--sync-org` is: nothing here is a decision anybody made.
    with session_scope() as session:
        result = runner.sync_health(session)
    print(
        f"{result['extended']} services given {result['points']} points of history"
        if result["extended"]
        else "every service already has a month of history"
    )
    return 0


def sync_jobs(args, engine) -> int:
    """--sync-jobs."""
    # `JOB_STATUS` is what `/admin/jobs` builds its filters from, and
    # RETRYING is weighted low enough that a small scale often leaves it
    # empty — a filter that can never match anything (§76). Additive: it
    # never edits an existing job, because a job's status is a record of
    # what happened.
    with session_scope() as session:
        result = runner.sync_jobs(session)
    print(
        f"{result['added']} added"
        + (
            f" covering {result['statuses']} statuses"
            if result["added"]
            else " — every status already has the guaranteed minimum"
        )
    )
    return 0


def sync_settings(args, engine) -> int:
    """--sync-settings."""
    # What an ordinary deploy needs: the catalogue gains a setting, or an
    # existing one gains a type and a range, and seeding refuses to touch a
    # populated database. Chosen values survive; a value that no longer
    # fits its own declaration is reset, and counted separately.
    with session_scope() as session:
        result = runner.sync_settings(session)
    print(
        f"{result['added']} added, {result['updated']} updated"
        + (f", {result['reset']} reset to the new default" if result["reset"] else "")
    )
    return 0
