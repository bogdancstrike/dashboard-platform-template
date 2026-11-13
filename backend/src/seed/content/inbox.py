"""Seed data for content: inbox_thread."""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.world import World

RESOURCE_TYPES = ("project", "task", "ticket", "customer", "order", "device", "file")


#: What a top-level folder's children are called.
SUBFOLDER_NAMES = ("2024", "2025", "2026", "Drafts", "Approved", "Signed", "Inbound", "Outbound")


#: How many inbox threads every persona is guaranteed, whatever the scale and
#: whatever the random folder draw did.
GUARANTEED_INBOX = 6


def inbox_thread(rng, owner, sender, anchor, index: int, counter: int):
    """One inbound thread and its message, built but not stored.

    Shared by the seed and by `--sync-mailboxes`, which tops up an existing
    database. Two copies of "what an inbound thread looks like" is how a
    repaired mailbox comes to render differently from a seeded one.

    `index` decides the states rather than a coin flip: every third one is
    unread, every fourth starred, every fifth flagged. A demo needs each of
    those states *present*, and a random draw over six threads sometimes
    produces none of one.
    """
    from src.models.content import EmailMessage, EmailThread

    subject = rng.pick(catalog.EMAIL_SUBJECTS)
    sent_at = anchor - timedelta(hours=rng.integer(1, 320))
    body = "\n\n".join(rng.sample(catalog.EMAIL_PARAGRAPHS, rng.integer(1, 2)))
    is_read = index % 3 != 0
    labels = rng.sample(catalog.EMAIL_LABELS, rng.integer(0, 2)) or None

    thread = EmailThread(
        id=rng.uuid(),
        subject=subject,
        folder="INBOX",
        owner_id=owner.id,
        organization_id=owner.organization_id,
        message_count=1,
        unread_count=0 if is_read else 1,
        labels=labels,
        is_starred=index % 4 == 0,
        is_important=index % 5 == 0,
        last_message_at=sent_at,
        snippet=body[:400],
        participants=[
            {"name": sender.full_name, "email": sender.email},
            {"name": owner.full_name, "email": owner.email},
        ],
        created_at=sent_at,
    )
    message = EmailMessage(
        id=rng.uuid(),
        thread_id=thread.id,
        message_ref=f"<{rng.uuid().hex[:20]}.{counter}@nucleus.example>",
        subject=subject,
        from_name=sender.full_name,
        from_email=sender.email,
        to_recipients=[{"name": owner.full_name, "email": owner.email}],
        body_html=f"<p>{body.replace(chr(10) + chr(10), '</p><p>')}</p>",
        body_text=body,
        preview=body[:200],
        folder="INBOX",
        is_read=is_read,
        is_draft=False,
        priority=rng.weighted(catalog.EMAIL_PRIORITIES),
        labels=labels,
        sender_id=sender.id,
        owner_id=owner.id,
        sent_at=sent_at,
        read_at=sent_at + timedelta(minutes=rng.integer(2, 600)) if is_read else None,
        attachment_count=0,
        created_at=sent_at,
    )
    return thread, message


def _cover_every_persona_inbox(world: World) -> None:
    """Make sure each demo account has a mailbox worth opening.

    `_mailbox` already says "the personas own most of the mail — an inbox is
    only worth looking at from an account that has one", and at the small scale
    it did not deliver on that: ten threads spread over five personas and five
    folders left the *administrator* — the account everybody signs in as first
    — with two threads, neither of them in the inbox. An empty inbox on a demo
    reads as a broken feature.

    So the folder draw stays random and this fills the gap afterwards. The same
    shape as `business._cover_every_task_status`, and for the same reason: a
    seed whose distribution is only *usually* right ships a demo that is
    sometimes empty.
    """
    rng = world.rng.derive("mailbox-cover")
    counted: dict = {}
    for thread in world.email_threads:
        if thread.folder == "INBOX":
            counted[thread.owner_id] = counted.get(thread.owner_id, 0) + 1

    owners = list(world.personas.values()) or world.users[:5]
    counter = len(world.email_messages)

    for owner in owners:
        colleagues = [
            person
            for person in world.users_by_org.get(owner.organization_id, [])
            if person.id != owner.id
        ]
        for index in range(max(0, GUARANTEED_INBOX - counted.get(owner.id, 0))):
            counter += 1
            sender = rng.pick(colleagues) if colleagues else owner
            thread, message = inbox_thread(rng, owner, sender, world.anchor, index, counter)
            world.email_threads.append(thread)
            world.email_messages.append(message)
