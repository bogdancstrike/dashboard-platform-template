"""Generating the world, writing it, and the whole run."""

from __future__ import annotations

import time
from typing import Any

from src.config import Config
from src.core.clock import now
from src.seed import assistant as assistant_seed
from src.seed import business, content, identity, operations, personal
from src.seed import collab as collab_seed
from src.seed import decisions as decisions_seed
from src.seed import developers as developers_seed
from src.seed import insights as insights_seed
from src.seed import knowledge as knowledge_seed
from src.seed import onboarding as onboarding_seed
from src.seed import planning as planning_seed
from src.seed import records_analytics as analytics_seed
from src.seed import report_documents as report_documents_seed
from src.seed import workflows as workflows_seed
from src.seed.runner.schema import DEFERRED_LINKS, INSERT_ORDER
from src.seed.runner.tags_sync import sync_tags
from src.seed.support import Rng
from src.seed.world import SCALES, Scale, World


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
    assistant_seed.seed_safely(session)  # assistant conversations (§41)
    knowledge_seed.seed_safely(session)  # Ask your documents (§44)
    insights_seed.seed_safely(session)  # Insights (§43)
    report_documents_seed.seed_safely(session)  # Report builder documents (§28)
    planning_seed.populate(session)  # sprints, epics, dependencies, templates (§18)
    analytics_seed.seed_safely(session)  # health, contracts, versions, alerts, links (§12–25)
    collab_seed.seed(session)  # chat, the wiki and meeting notes (§47–49)
    decisions_seed.populate(session)  # SLA policies, approvals, time, intake forms
    onboarding_seed.populate(session)  # onboarding checklists in progress (§38)
    developers_seed.populate(session)  # real API examples and two weeks of API usage (§31)
    workflows_seed.populate(session)  # canvas workflows with run history (§49)
    written = time.perf_counter()

    log.info(
        f"seed[{resolved.name}] {world.total()} rows across {len(counts)} tables "
        f"(build {built - started:.1f}s, write {written - built:.1f}s, seed={seed_value})",
        "green",
    )
    return counts
