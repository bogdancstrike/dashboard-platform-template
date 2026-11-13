"""Shared helpers and fixtures for the audit tests."""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return persona_claims(username, role, sid=f"audit-{username}")


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.tokens.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer audit-{username}"}


@pytest.fixture()
def planted(has_database):
    """Audit rows a test writes, removed however the test ends."""
    identifiers: list = []
    yield identifiers

    if not has_database or not identifiers:
        return
    from sqlalchemy import delete as sql_delete

    from src.core.db import session_scope
    from src.models.platform import AuditLog

    with session_scope() as session:
        session.execute(sql_delete(AuditLog).where(AuditLog.id.in_(identifiers)))


def _plant(planted: list, **overrides):
    """One audit row, written the way `core/audit.record` writes them."""
    from src.core.audit import diff
    from src.core.clock import now
    from src.core.db import session_scope
    from src.models.platform import AuditLog

    before = overrides.pop("before", None)
    after = overrides.pop("after", None)
    changes = diff(before, after)

    with session_scope() as session:
        row = AuditLog(
            id=uuid4(),
            occurred_at=overrides.pop("occurred_at", now()),
            action=overrides.pop("action", "UPDATE"),
            resource_type=overrides.pop("resource_type", "audit_test"),
            resource_id=overrides.pop("resource_id", str(uuid4())),
            resource_label=overrides.pop("resource_label", "audit-test row"),
            actor_label=overrides.pop("actor_label", "Audit Test"),
            actor_role=overrides.pop("actor_role", "ADMINISTRATOR"),
            result=overrides.pop("result", "SUCCESS"),
            correlation_id=overrides.pop("correlation_id", uuid4().hex),
            state_before=before,
            state_after=after,
            changed_fields=list(changes) or None,
            changes=changes or None,
            **overrides,
        )
        session.add(row)
        session.flush()
        identifier = row.id
    planted.append(identifier)
    return identifier
