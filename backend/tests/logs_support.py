"""Shared helpers and fixtures for the logs tests."""

from __future__ import annotations

import uuid

import pytest

from src.config import Config
from src.core.clock import now
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


LOGS = f"{PREFIX}/admin/logs"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"log-{username}"),
    )
    return {"Authorization": f"Bearer log-{username}"}


def _line(**overrides):
    """One log line, written straight through the sink's own writer."""
    from src.models.platform import SystemLog

    row = {
        "level": "INFO",
        "service": "platform-api",
        "logger": "api.request",
        "message": "GET /platform/things → 200",
        "correlation_id": uuid.uuid4().hex,
        "environment": "test",
        "duration_ms": 12.5,
        "status_code": 200,
        "context": {"method": "GET", "path": "/platform/things"},
    }
    row.update(overrides)
    logged_at = row.pop("logged_at", None) or now()
    with session_scope() as session:
        line = SystemLog(logged_at=logged_at, **row)
        session.add(line)
        session.flush()
        return str(line.id), row["correlation_id"]
