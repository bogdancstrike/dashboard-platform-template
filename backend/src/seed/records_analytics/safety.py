"""Seed data for records analytics: seed_safely."""

from __future__ import annotations

from src.seed.records_analytics.population import populate


def seed_safely(session) -> None:
    """From the main seed: a demo nicety must never fail the whole run."""
    try:
        with session.begin_nested():
            populate(session)
    except Exception as exc:  # pragma: no cover - defensive
        from framework.commons.logger import logger as log

        log.info(f"records & analytics seed skipped: {exc}", "yellow")
