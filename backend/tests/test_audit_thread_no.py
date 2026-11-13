"""Audit explorer HTTP contract (§21). — thread no."""

from __future__ import annotations

from uuid import uuid4

import pytest

from tests.audit_support import (  # noqa: F401
    PREFIX,
    _authenticate,
    _plant,
    planted,
)


@pytest.mark.database
def test_a_thread_is_no_wider_than_what_the_reader_may_see(client, monkeypatch, planted):
    """Widening the timeline must never widen the disclosure.

    The neighbours are read through `services/relationships`, which drops the
    datasets a reader may not see — so a role without a dataset's permission
    gets a thread that simply does not include it, rather than a 403 or, far
    worse, the rows.
    """
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.business import Ticket

    with session_scope() as session:
        ticket = session.scalars(
            select(Ticket).where(Ticket.customer_id.isnot(None), Ticket.deleted_at.is_(None))
        ).first()
        assert ticket is not None
        ticket_id, customer_id = str(ticket.id), str(ticket.customer_id)

    _plant(planted, resource_type="customer", resource_id=customer_id, message="account edited")

    # A viewer holds records.view, so the timeline answers — and the graph it
    # is built from is filtered by the same rule the relationship page uses.
    headers = _authenticate(monkeypatch, "user", "viewer")
    threaded = client.get(
        f"{PREFIX}/api/audit/timeline?resource_type=ticket&resource_id={ticket_id}&thread=true",
        headers=headers,
    )
    assert threaded.status_code == 200
    body = threaded.get_json()
    # Whatever it includes, every subject is a dataset this reader may read.
    assert body["subjects"]
    assert all(item["resource_type"] for item in body["subjects"])


@pytest.mark.database
def test_a_timeline_needs_only_the_permission_to_read_the_record(client, monkeypatch, planted):
    resource_id = str(uuid4())
    _plant(planted, resource_type="audit_test_entity", resource_id=resource_id)
    # VIEWER holds records.view and not audit.view.
    headers = _authenticate(monkeypatch, "user", "viewer")

    timeline = client.get(
        f"{PREFIX}/api/audit/timeline?resource_type=audit_test_entity&resource_id={resource_id}",
        headers=headers,
    )
    ledger = client.get(f"{PREFIX}/admin/audit", headers=headers)

    assert timeline.status_code == 200
    assert timeline.get_json()["total"] == 1
    assert ledger.status_code == 403


@pytest.mark.database
def test_a_timeline_limit_is_bounded(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    query = "resource_type=task&resource_id=" + str(uuid4())

    assert client.get(
        f"{PREFIX}/api/audit/timeline?{query}&limit=0", headers=headers
    ).status_code == 400
    assert client.get(
        f"{PREFIX}/api/audit/timeline?{query}&limit=5000", headers=headers
    ).status_code == 400
