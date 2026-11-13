"""The mailbox (§14–§16). — The denormalised summary."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from tests.mail_support import (  # noqa: F401
    MESSAGES,
    THREADS,
    _authenticate,
    _compose,
    _inbox_thread,
    pytestmark,
)


def test_the_threads_summary_is_recomputed_from_its_messages(client, monkeypatch):
    """Recomputed and never adjusted: a decremented counter drifts the first
    time two things happen at once, and a wrong unread badge is the single most
    irritating bug a mail client can have."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, subject="Mail test — counted", send=True)

    for index in range(2):
        thread = client.post(
            MESSAGES,
            json={"thread_id": thread["id"], "body": f"Reply {index}.",
                  "to": ["someone@example.com"], "send": True},
            headers=headers,
        ).get_json()

    assert thread["message_count"] == 3

    from src.models.content import EmailMessage, EmailThread

    with session_scope() as session:
        row = session.get(EmailThread, thread["id"])
        live = session.scalars(
            select(EmailMessage).where(
                EmailMessage.thread_id == row.id, EmailMessage.deleted_at.is_(None)
            )
        ).all()
        assert row.message_count == len(live)
        assert row.unread_count == sum(1 for item in live if not item.is_read)
        assert row.snippet and row.snippet.startswith("Reply 1")


def test_a_thread_names_the_people_in_it(client, monkeypatch):
    """Which is how a mail client titles a conversation — "Ada, Mara, you"."""
    headers = _authenticate(monkeypatch)
    thread = _compose(
        client, headers, subject="Mail test — people", send=True,
        to=["first@example.com", "second@example.com"],
    )
    emails = {person["email"] for person in thread["participants"]}
    assert {"first@example.com", "second@example.com"} <= emails
    # Initials from `core/naming`, like every other person the platform draws.
    assert all(person["initials"] for person in thread["participants"])


def test_filing_mail_is_audited_but_not_in_the_activity_feed(client, monkeypatch):
    """Where somebody files their own mail is nobody else's business, and a
    feed of it would drown everything that is (§35)."""
    headers = _authenticate(monkeypatch)
    thread = _inbox_thread(client, headers, subject="Mail test — audited")
    client.put(f"{THREADS}/{thread['id']}", json={"folder": "ARCHIVE"}, headers=headers)

    from src.models.platform import ActivityEntry, AuditLog

    with session_scope() as session:
        entry = session.scalars(
            select(AuditLog)
            .where(
                AuditLog.resource_type == "email_thread",
                AuditLog.resource_id == thread["id"],
                AuditLog.action == "mail.move",
            )
            .order_by(AuditLog.occurred_at.desc())
        ).first()
        assert entry is not None
        assert entry.state_after["folder"] == "ARCHIVE"

        feed = session.scalars(
            select(ActivityEntry).where(
                ActivityEntry.resource_type == "email_thread",
                ActivityEntry.resource_id == thread["id"],
            )
        ).all()
        assert feed == []
