"""Shared helpers and fixtures for the jobs tests."""

from __future__ import annotations

import uuid

import pytest

from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


JOBS = f"{PREFIX}/admin/jobs"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"job-{username}"),
    )
    return {"Authorization": f"Bearer job-{username}"}


def _job(**overrides) -> str:
    """One job of this test's own, so nothing here edits a seeded row."""
    from src.core.clock import now
    from src.models.platform import BackgroundJob

    row = {
        "reference": f"JOB-T{uuid.uuid4().hex[:8]}",
        "name": "Report — projects",
        # Not EXPORT: this console does not retry those (§30), so a fixture of
        # that kind would test the refusal rather than the retry. The export
        # refusal has its own test below.
        "kind": "REPORT",
        "queue": "default",
        "status": "FAILED",
        "priority": "NORMAL",
        "progress": 40,
        "total_units": 100,
        "processed_units": 40,
        "failed_units": 60,
        "attempt": 1,
        "max_attempts": 3,
        "started_at": now(),
        "error_message": "Upstream timed out after 30s",
        "log_lines": [{"at": None, "level": "ERROR", "message": "it broke"}],
    }
    row.update(overrides)
    with session_scope() as session:
        job = BackgroundJob(**row)
        session.add(job)
        session.flush()
        return str(job.id)


def _read(client, headers, job_id: str) -> dict:
    answer = client.get(f"{JOBS}/{job_id}", headers=headers)
    assert answer.status_code == 200, answer.get_json()
    return answer.get_json()


class _Row:
    """The four fields `can_retry` and `can_cancel` read, and nothing else."""

    def __init__(
        self,
        status: str,
        attempt: int = 1,
        max_attempts: int = 3,
        kind: str = "REPORT",
    ):
        self.status = status
        self.attempt = attempt
        self.max_attempts = max_attempts
        # A kind this console owns, so these cases test the status and attempt
        # rules rather than the kind rule (§30). The kind rule has its own
        # parametrised case below.
        self.kind = kind
