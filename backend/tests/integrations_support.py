"""Shared helpers and fixtures for the integrations tests."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


INTEGRATIONS = f"{PREFIX}/admin/integrations"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"int-{username}"),
    )
    return {"Authorization": f"Bearer int-{username}"}


def _any(client, headers, **wanted) -> dict:
    listing = client.get(f"{INTEGRATIONS}?page_size=100", headers=headers).get_json()
    assert listing["items"], "the seed has no integrations"
    for row in listing["items"]:
        if all(row.get(key) == value for key, value in wanted.items()):
            return row
    pytest.skip(f"no seeded integration matches {wanted}")


def _unconfigured(client, headers) -> tuple[dict, dict]:
    """An integration with a required setting cleared, and how to put it back.

    Made rather than found: these tests used to look for a seeded row that
    happened to be incomplete, and skipped on an installation whose rows were
    all complete — four tests quietly not running. Clearing a setting is the
    same act an operator performs, so the state is real rather than contrived.
    """
    row = _any(client, headers, configured=True)
    required = row["required_settings"]
    assert required, f"{row['name']} requires nothing, so it cannot be made incomplete"
    name = required[-1]

    from src.models.platform import Integration

    with session_scope() as session:
        stored = session.scalar(
            select(Integration).where(Integration.id == uuid.UUID(row["id"]))
        )
        original = dict(stored.configuration or {})

    answer = client.put(
        f"{INTEGRATIONS}/{row['id']}", headers=headers, json={"configuration": {name: ""}}
    )
    assert answer.status_code == 200, answer.get_json()
    return answer.get_json(), original


def _restore(row_id: str, configuration: dict) -> None:
    """Put a configuration back exactly, so the demo is what it was."""
    from src.models.platform import Integration

    with session_scope() as session:
        stored = session.scalar(
            select(Integration).where(Integration.id == uuid.UUID(row_id))
        )
        stored.configuration = configuration


class _Row:
    """The four fields `state` and `missing_settings` read, and nothing else."""

    def __init__(self, required=(), configuration=None, status="CONNECTED"):
        self.required_settings = list(required)
        self.configuration = dict(configuration or {})
        self.status = status
