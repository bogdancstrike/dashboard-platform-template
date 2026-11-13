"""Shared helpers and fixtures for the chat tests."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


CHANNELS = f"{PREFIX}/api/chat/channels"


COMMENTS = f"{PREFIX}/api/comments"


ROLES = {"admin": "administrator", "manager": "manager", "operator": "operator",
         "analyst": "analyst", "user": "user"}


@pytest.fixture()
def people(monkeypatch):
    """Headers for each persona, one token per person."""

    def verify(token: str):
        username = token.removeprefix("chat-")
        return persona_claims(username, ROLES[username], sid=f"chat-{username}")

    monkeypatch.setattr("src.core.auth.tokens.verify_token", verify)
    return {name: {"Authorization": f"Bearer chat-{name}"} for name in ROLES}


@pytest.fixture()
def live_calls(monkeypatch):
    """Every live hint published, instead of sending it anywhere."""
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr("src.services.collaboration.live.publish_to_user",
                        lambda user, payload: calls.append((str(user), payload)) or 1)
    monkeypatch.setattr("src.services.collaboration.live.publish_to_all",
                        lambda payload: calls.append(("*", payload)) or 1)
    return calls


def _user_id(username: str) -> UUID:
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        return session.scalars(select(User.id).where(User.username == username)).one()


def _name() -> str:
    return f"test-{uuid4().hex[:8]}"


def _post(client, headers, channel_id, body, **extra):
    return client.post(COMMENTS, json={"resource_type": "chat_channel", "resource_id": channel_id,
                                       "body": body, **extra}, headers=headers)
