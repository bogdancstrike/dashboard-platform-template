"""Shared helpers and fixtures for the kanban tests."""

from __future__ import annotations

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


BOARDS = f"{PREFIX}/api/kanban/boards"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"kanban-{username}"),
    )
    return {"Authorization": f"Bearer kanban-{username}"}


def _board(client, headers, **overrides):
    """A board of this test's own, so no test depends on the seed's shape."""
    payload = {"name": "Test board", "scope": "PRIVATE"}
    payload.update(overrides)
    response = client.post(BOARDS, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _open(client, headers, board_id):
    response = client.get(f"{BOARDS}/{board_id}", headers=headers)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _card(client, headers, board_id, **overrides):
    payload = {"title": "A piece of work", "kind": "TASK"}
    payload.update(overrides)
    response = client.post(
        f"{BOARDS}/{board_id}/cards", json=payload, headers=headers
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()
