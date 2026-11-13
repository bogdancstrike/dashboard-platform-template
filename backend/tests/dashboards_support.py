"""Shared helpers and fixtures for the dashboards tests."""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


DASHBOARDS = f"{PREFIX}/api/dashboards"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"dash-{username}"),
    )
    return {"Authorization": f"Bearer dash-{username}"}


@pytest.fixture()
def scratch(client, monkeypatch, has_database):
    """A dashboard this test owns, removed however the test ends.

    The suite runs against the same PostgreSQL the application serves, so a
    test that leaves rows behind changes what the next person to open the demo
    sees.
    """
    if not has_database:
        pytest.skip("needs PostgreSQL")
    headers = _authenticate(monkeypatch)
    created = client.post(
        DASHBOARDS, json={"name": f"Scratch {uuid4().hex[:8]}"}, headers=headers
    )
    assert created.status_code == 201, created.get_json()
    body = created.get_json()

    yield body, headers

    client.delete(f"{DASHBOARDS}/{body['id']}", headers=_authenticate(monkeypatch))
