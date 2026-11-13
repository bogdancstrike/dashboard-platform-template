"""Shared helpers and fixtures for the mail tests."""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


THREADS = f"{PREFIX}/api/mail/threads"


MESSAGES = f"{PREFIX}/api/mail/messages"


TEMPLATES = f"{PREFIX}/api/mail/templates"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"mail-{username}"),
    )
    return {"Authorization": f"Bearer mail-{username}"}


def _compose(client, headers, **overrides):
    payload = {
        "subject": "Mail test — a message",
        "body": "First paragraph.\n\nSecond paragraph.",
        "to": ["someone@example.com"],
    }
    payload.update(overrides)
    response = client.post(MESSAGES, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _inbox_thread(client, headers, *, unread: bool = False, **overrides):
    """A thread of this test's own, in the inbox.

    Composed and then filed, rather than picked out of the seeded mailbox.
    **No test in this file reads the seeded mailbox**, and that is deliberate:
    the first version did, and its own earlier tests archived the threads the
    later ones went looking for — draining the administrator's inbox
    permanently, because the autouse cleanup removes rows a test *created* and
    cannot un-archive rows it *edited*. The same mistake the board spec made
    with its one draggable card.

    `unread=True` goes through the bulk endpoint, which is the only way to make
    a thread unread: a message somebody composed has by definition been read by
    its author.
    """
    thread = _compose(client, headers, **overrides)
    filed = client.put(
        f"{THREADS}/{thread['id']}", json={"folder": "INBOX"}, headers=headers
    )
    assert filed.status_code == 200, filed.get_data(as_text=True)
    if unread:
        client.post(
            f"{THREADS}/bulk",
            json={"ids": [thread["id"]], "action": "UNREAD"},
            headers=headers,
        )
        return client.get(
            f"{THREADS}/{thread['id']}?peek=1", headers=headers
        ).get_json()
    return filed.get_json()


def _folder(answer, name: str) -> dict:
    return next(item for item in answer["folders"] if item["key"] == name)
