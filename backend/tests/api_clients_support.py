"""Shared helpers and fixtures for the api clients tests."""

from __future__ import annotations

import uuid

import pytest

from src.config import Config
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


CLIENTS = f"{PREFIX}/admin/api-clients"


CREDENTIALS = f"{PREFIX}/admin/api-credentials"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"api-{username}"),
    )
    return {"Authorization": f"Bearer api-{username}"}


def _make(client, headers, **extra) -> dict:
    body = {"name": extra.pop("name", f"Test client {uuid.uuid4().hex[:6]}"), **extra}
    answer = client.post(CLIENTS, headers=headers, json=body)
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()
