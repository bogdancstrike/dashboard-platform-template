"""Shared helpers and fixtures for the assistant tests."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from src.config import Config
from src.core import llm
from src.core.auth import ALL_PERMISSIONS, Principal
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


BASE = f"{PREFIX}/api/assistant"


@pytest.fixture(autouse=True)
def _fake_model():
    llm.set_client(llm.FakeClient())
    yield
    llm.set_client(None)


def _script(*replies):
    fake = llm.FakeClient(script=list(replies))
    llm.set_client(fake)
    return fake


def _auth(monkeypatch, username="admin", role="administrator"):
    monkeypatch.setattr("src.core.auth.tokens.verify_token",
                        lambda _t: persona_claims(username, role, sid=f"ai-{username}"))
    return {"Authorization": f"Bearer ai-{username}"}


def _principal(username="admin", permissions=ALL_PERMISSIONS) -> Principal:
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        user = session.scalars(select(User).where(User.username == username)).one()
        return Principal(user_id=user.id, subject="", email=user.email, username=username,
                         full_name=user.full_name, role_code="ADMINISTRATOR", permissions=frozenset(permissions))


def _events(response) -> list[tuple[str, dict]]:
    out = []
    for block in response.get_data(as_text=True).split("\n\n"):
        if not block.strip():
            continue
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def _new(client, headers, **body):
    response = client.post(f"{BASE}/conversations", json=body, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _notify(user_id):
    from src.core.db import session_scope
    from src.models.platform import Notification

    with session_scope() as session:
        session.add(Notification(user_id=user_id, title="Something happened", is_read=False))


PAGE = {
    "path": "/tasks",
    "stops": [{"title": "Filter your work", "description": "Narrow the list by status and owner.", "target": "task-filters"}],
    "controls": [{"id": "new-task", "label": "New task"}, {"id": "", "label": "ignored"}],
    "commands": [{"id": "tasks.new", "label": "Create a task", "keywords": "add new task create"}],
}
