"""Shared helpers and fixtures for the favorites tests."""

from __future__ import annotations

import uuid

import pytest

from src.config import Config
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


FAVORITES = f"{PREFIX}/favorites"


RECENTS = f"{PREFIX}/recents"


REPORTS = f"{PREFIX}/api/reports"


SEARCHES = f"{PREFIX}/api/saved-searches"


def _authenticate(monkeypatch, username: str = "analyst", role: str = "analyst"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"fav-{username}"),
    )
    return {"Authorization": f"Bearer fav-{username}"}


def _mine(client, headers) -> dict:
    answer = client.get(FAVORITES, headers=headers)
    assert answer.status_code == 200, answer.get_json()
    return answer.get_json()


def _bookmark(client, headers, **overrides) -> dict:
    body = {
        "resource_type": "ticket",
        "resource_id": str(uuid.uuid4()),
        "label": "Bookmark test",
        "url": "/tickets/whatever",
        **overrides,
    }
    answer = client.post(FAVORITES, json=body, headers=headers)
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()
