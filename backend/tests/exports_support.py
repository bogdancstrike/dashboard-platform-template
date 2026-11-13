"""Shared helpers and fixtures for the exports tests."""

from __future__ import annotations

import pytest

from src.config import Config
from src.core import background, storage
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


EXPORTS = f"{PREFIX}/exports"


#: The dataset these tests export. Small, seeded, and filterable by a field
#: with a closed value set, which is what makes the "same question" assertion
#: possible without inventing rows.
RESOURCE = "ticket"


def _authenticate(monkeypatch, username: str = "analyst", role: str = "analyst"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"exp-{username}"),
    )
    return {"Authorization": f"Bearer exp-{username}"}


def _queue(client, headers, **payload):
    """Queue an export and wait for it by not needing to.

    `background.synchronous()` makes `spawn` run inline for the duration, so
    the response describes a finished job. A test that polled instead would be
    a test that passes when the work is fast and flakes when it is not.
    """
    body = {"resource_type": RESOURCE, "format": "csv", **payload}
    with background.synchronous():
        response = client.post(EXPORTS, json=body, headers=headers)
    return response


def _artifact(export_id: str) -> tuple[str, bytes]:
    """The key and bytes of what was actually stored for one export."""
    from src.models.platform import BackgroundJob

    with session_scope() as session:
        row = session.get(BackgroundJob, export_id)
        assert row is not None
        key = str((row.result or {}).get("artifact") or "")
    assert key, "the export recorded no artefact"
    return key, storage.for_config().get(key)


def _discard(client, headers, export_id: str) -> None:
    """Let an export go entirely, through the endpoint a person would use.

    Twice, because `forget` takes two presses — the file, then the record — and
    a sweep that pressed once would leave a row behind for every test in this
    module. The same shape `e2e/api.sweepMailThreads` documents for threads.
    """
    client.delete(f"{EXPORTS}/{export_id}", headers=headers)
    client.delete(f"{EXPORTS}/{export_id}", headers=headers)
