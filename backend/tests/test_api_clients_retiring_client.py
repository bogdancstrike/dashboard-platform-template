"""API clients and their credentials (§25): machines that call the platform. — retiring a client."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.core import vocabulary
from src.core.db import session_scope
from src.services.platform import api_clients as service
from tests.api_clients_support import (  # noqa: F401
    CLIENTS,
    _authenticate,
    _make,
    pytestmark,
)


def test_retiring_a_client_revokes_its_keys(client, monkeypatch):
    """A soft-deleted client whose credentials stayed live would be a consumer
    nothing lists any more, still able to call — the same shape of bug a
    retired group had."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Retired with keys")
    client.post(
        f"{CLIENTS}/{made['id']}/rotate", headers=headers, json={}
    )  # a second live key

    answer = client.delete(f"{CLIENTS}/{made['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["credentials_revoked"] == 2

    from src.models.platform import ApiCredential

    with session_scope() as session:
        rows = session.scalars(
            select(ApiCredential).where(ApiCredential.api_client_id == uuid.UUID(made["id"]))
        ).all()
        assert rows
        assert all(row.revoked_at is not None for row in rows)


def test_a_retired_client_is_gone_from_the_listing(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Gone")
    client.delete(f"{CLIENTS}/{made['id']}", headers=headers)

    listing = client.get(f"{CLIENTS}?page_size=100", headers=headers).get_json()
    assert made["id"] not in {row["id"] for row in listing["items"]}
    assert client.get(f"{CLIENTS}/{made['id']}", headers=headers).status_code == 404


def test_the_lifetime_counter_and_the_recent_window_are_separate(client, monkeypatch):
    """Three point seven million requests against twelve logged rows is not a
    contradiction — one is a lifetime counter the gateway keeps and the other
    is a recent window. A screen that merged them would read as one answer to
    two different questions (§71)."""
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{CLIENTS}?page_size=5", headers=headers).get_json()
    seeded = next((row for row in listing["items"] if row["requests_total"] > 0), None)
    if seeded is None:
        pytest.skip("no seeded client has traffic")

    detail = client.get(f"{CLIENTS}/{seeded['id']}", headers=headers).get_json()
    # Both present, and named differently.
    assert detail["requests_total"] >= 0
    assert detail["recent_window"] == len(detail["recent_requests"])
    assert detail["recent_failures"] <= detail["recent_window"]
    assert detail["recent_window"] <= service.MAX_REQUESTS


def test_limits_are_bounded(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.post(
        CLIENTS, headers=headers, json={"name": "Silly limit", "rate_limit_per_minute": 0}
    )
    assert answer.status_code == 400
    assert answer.get_json()["details"]["minimum"] == 1


def test_a_status_outside_the_vocabulary_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Odd status")
    answer = client.put(f"{CLIENTS}/{made['id']}", headers=headers, json={"status": "PAUSED"})
    assert answer.status_code == 400
    assert answer.get_json()["details"]["allowed"] == list(vocabulary.API_CLIENT_STATUS)


def test_the_audit_row_names_the_scopes_that_were_granted(client, monkeypatch):
    """"created an API client" without the scopes is an entry that does not
    record what was granted."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Audited", scopes=["audit.view"])

    from src.models.platform import AuditLog

    with session_scope() as session:
        row = session.scalar(
            select(AuditLog)
            .where(AuditLog.resource_type == "api_client", AuditLog.resource_id == made["id"])
            .order_by(AuditLog.occurred_at.desc())
        )
    assert row is not None
    assert "audit.view" in row.message


def test_a_scope_change_is_named_in_the_audit(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Scope moved", scopes=["audit.view"])
    client.put(
        f"{CLIENTS}/{made['id']}", headers=headers, json={"scopes": ["records.view"]}
    )

    from src.models.platform import AuditLog

    with session_scope() as session:
        row = session.scalar(
            select(AuditLog)
            .where(AuditLog.resource_type == "api_client", AuditLog.resource_id == made["id"])
            .order_by(AuditLog.occurred_at.desc())
        )
    assert "+records.view" in row.message
    assert "-audit.view" in row.message


def test_everything_here_needs_api_manage(client, monkeypatch):
    """Reading is not a lesser privilege: a client's scopes and its allowed
    addresses are exactly what somebody would want before attacking it."""
    for username, role in (("manager", "manager"), ("user", "viewer"), ("analyst", "analyst")):
        headers = _authenticate(monkeypatch, username, role)
        assert client.get(CLIENTS, headers=headers).status_code == 403, username
        assert client.get(f"{CLIENTS}/catalogue", headers=headers).status_code == 403, username
        assert (
            client.post(CLIENTS, headers=headers, json={"name": "Nope"}).status_code == 403
        ), username
