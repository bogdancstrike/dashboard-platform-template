"""The mailbox (§14–§16). — Writing."""

from __future__ import annotations

from src.core.db import session_scope
from tests.mail_support import (  # noqa: F401
    MESSAGES,
    THREADS,
    _authenticate,
    _compose,
    _inbox_thread,
    pytestmark,
)


def test_a_draft_starts_in_drafts_and_is_not_sent(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers)

    assert thread["folder"] == "DRAFTS"
    assert thread["has_draft"] is True
    assert thread["messages"][0]["is_draft"] is True
    assert thread["messages"][0]["sent_at"] is None


def test_a_sent_message_goes_to_outbox_and_not_to_sent(client, monkeypatch):
    """Nothing has transported it. The folder is the whole claim the row
    makes, and `SENT` would be a lie about the one thing a mailbox is for."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, send=True, subject="Mail test — queued")

    assert thread["folder"] == "OUTBOX"
    assert thread["messages"][0]["is_draft"] is False
    assert thread["messages"][0]["sent_at"] is not None


def test_a_message_with_no_recipient_may_be_drafted_and_not_sent(client, monkeypatch):
    """A draft with nobody in it is what a draft is *for*."""
    headers = _authenticate(monkeypatch)
    draft = _compose(client, headers, to=[], subject="Mail test — no recipient")
    assert draft["folder"] == "DRAFTS"

    response = client.post(
        MESSAGES,
        json={"subject": "Mail test — nowhere", "body": "x", "to": [], "send": True},
        headers=headers,
    )
    assert response.status_code == 400
    assert "recipient" in response.get_json()["message"]


def test_an_address_that_is_not_an_address_is_refused_with_the_reason(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        MESSAGES,
        json={"subject": "Mail test — bad address", "body": "x", "to": ["not-an-address"]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "not-an-address" in response.get_json()["message"]


def test_a_recipient_may_be_a_string_or_an_object_and_is_stored_one_way(
    client, monkeypatch
):
    """Two accepted spellings would be two renderings of a recipient list."""
    headers = _authenticate(monkeypatch)
    thread = _compose(
        client,
        headers,
        subject="Mail test — shapes",
        to=["plain@example.com", {"name": "Named Person", "email": "NAMED@Example.com"}],
    )
    stored = thread["messages"][0]["to"]
    assert stored == [
        {"name": "", "email": "plain@example.com"},
        {"name": "Named Person", "email": "named@example.com"},
    ]


def test_a_reply_joins_the_conversation_rather_than_starting_one(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    existing = _inbox_thread(client, headers, subject="Mail test — conversation")
    before = existing["message_count"]

    answered = client.post(
        MESSAGES,
        json={"thread_id": existing["id"], "body": "Thanks — will do.",
              "to": ["someone@example.com"], "send": True},
        headers=headers,
    ).get_json()

    assert answered["id"] == existing["id"]
    assert answered["message_count"] == before + 1
    # A reply takes the subject of the thread it joins, prefixed once.
    assert answered["messages"][-1]["subject"].startswith("Re: ")


def test_a_draft_is_editable_until_it_goes_and_never_afterwards(client, monkeypatch):
    """A queued message is a record of something that happened."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, subject="Mail test — editable")
    message_id = thread["messages"][0]["id"]

    edited = client.put(
        f"{MESSAGES}/{message_id}",
        json={"subject": "Mail test — edited", "body": "Rewritten."},
        headers=headers,
    )
    assert edited.status_code == 200
    assert edited.get_json()["messages"][0]["body"] == "Rewritten."

    sent = client.put(f"{MESSAGES}/{message_id}", json={"send": True}, headers=headers)
    assert sent.status_code == 200
    assert sent.get_json()["messages"][0]["is_draft"] is False

    refused = client.put(
        f"{MESSAGES}/{message_id}", json={"body": "Too late."}, headers=headers
    )
    assert refused.status_code == 403
    assert "draft" in refused.get_json()["message"]


def test_discarding_a_draft_takes_its_empty_thread_with_it(client, monkeypatch):
    """A thread whose only message was the draft is not a conversation."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, subject="Mail test — discarded")
    message_id = thread["messages"][0]["id"]

    assert client.delete(f"{MESSAGES}/{message_id}", headers=headers).status_code == 200
    assert client.get(f"{THREADS}/{thread['id']}", headers=headers).status_code == 404


def test_the_body_is_stored_as_text_and_escaped_into_html(client, monkeypatch):
    """A mailbox is not a place to inject script into a colleague's browser."""
    headers = _authenticate(monkeypatch)
    thread = _compose(
        client, headers, subject="Mail test — markup",
        body="Hello <script>alert(1)</script>\n\nSecond.",
    )

    from src.models.content import EmailMessage

    with session_scope() as session:
        row = session.get(EmailMessage, thread["messages"][0]["id"])
        assert "<script>" not in row.body_html
        assert "&lt;script&gt;" in row.body_html
        # The text column keeps exactly what was typed.
        assert "<script>" in row.body_text
