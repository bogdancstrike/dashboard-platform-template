"""Exports that exist as things rather than as responses (§30). — the seeded exports."""

from __future__ import annotations

from sqlalchemy import select

from src.core import storage
from src.core.db import session_scope
from src.services.transfer import exports as service
from tests.exports_support import (  # noqa: F401
    pytestmark,
)


def test_no_seeded_export_claims_a_file_it_does_not_have():
    """The defect that building this page found, asserted against the database.

    Three of the seeded exports said `{"rows": 184203, "artifact":
    "exports/JOB-000004.csv"}` for bytes nobody had written — and the extension
    was `.csv` while the payload said `xlsx`, so even the name was wrong. Only
    the real installation can say whether that is still true of it.
    """
    from src.models.platform import BackgroundJob

    store = storage.for_config()
    with session_scope() as session:
        rows = session.scalars(
            select(BackgroundJob).where(BackgroundJob.kind == service.KIND)
        ).all()
        assert rows, "run `make seed`; there are no export jobs"

        claimed = [
            (row.reference, str((row.result or {}).get("artifact") or ""))
            for row in rows
            if (row.result or {}).get("artifact")
        ]

    missing = [
        reference for reference, key in claimed if store.stat(key) is None
    ]
    assert missing == [], "seeded exports name files that are not in storage"


def test_every_seeded_export_names_a_query_that_can_be_run():
    from src.models.platform import BackgroundJob
    from src.services.records import explorer

    with session_scope() as session:
        rows = session.scalars(
            select(BackgroundJob).where(BackgroundJob.kind == service.KIND)
        ).all()
        unreadable = []
        for row in rows:
            try:
                explorer.statement_of(explorer.replan(row.payload))
            except Exception:  # noqa: BLE001 - the point is that none do
                unreadable.append(row.reference)
    # The old payload named an `entity` no code could resolve, so `/exports`
    # could not describe a single seeded row.
    assert unreadable == []


def test_a_seeded_exports_counts_describe_its_file():
    from src.models.platform import BackgroundJob

    with session_scope() as session:
        rows = session.scalars(
            select(BackgroundJob).where(
                BackgroundJob.kind == service.KIND, BackgroundJob.status == "SUCCEEDED"
            )
        ).all()
        assert rows, "no seeded export has finished"
        wrong = [
            row.reference
            for row in rows
            if (row.result or {}).get("rows") != row.processed_units
            or row.processed_units != row.total_units
        ]
    # `result.rows` used to be a progress counter and `total_units` a random
    # integer, so a finished export agreed with neither.
    assert wrong == []


def test_every_persona_who_may_export_has_one_to_download():
    """Otherwise the page is empty for whoever signs in, which shows nothing.

    The guarantee `seed/exports._guarantee` exists for, and the same argument
    `sync_jobs` makes about a filter that can never match: the ordinary draw
    attributed exports to whoever it liked and left all five personas without
    a finished one.
    """
    from src.models.identity import User
    from src.models.platform import BackgroundJob

    store = storage.for_config()
    with session_scope() as session:
        people = session.scalars(
            select(User).where(
                User.username.in_(("admin", "manager", "operator", "analyst", "user")),
                User.deleted_at.is_(None),
            )
        ).all()
        assert people, "run `make seed`; the personas are not there"

        short = []
        for person in people:
            allowed = set((person.role.permissions if person.role else None) or ())
            if service.PERMISSION not in allowed:
                # A viewer holds no export privilege, so having none is right.
                continue
            rows = session.scalars(
                select(BackgroundJob).where(
                    BackgroundJob.kind == service.KIND,
                    BackgroundJob.initiated_by_id == person.id,
                    BackgroundJob.status == "SUCCEEDED",
                )
            ).all()
            if not any(
                store.stat(str((row.result or {}).get("artifact") or "") or "-") is not None
                for row in rows
            ):
                short.append(person.username)

    assert short == [], "run `make sync-exports`"
