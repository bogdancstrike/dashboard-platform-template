"""Seed data for content: _mailbox."""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.content.inbox import _cover_every_persona_inbox
from src.seed.support import slugify
from src.seed.world import World


def _mailbox(world: World) -> None:
    from src.models.content import EmailAttachment, EmailMessage, EmailThread

    rng = world.rng.derive("mailbox")
    if not world.users:
        return

    #: The personas own most of the mail — an inbox is only worth looking at
    #: from an account that has one.
    owners = [p for p in world.personas.values()] or world.users[:5]
    counter = 0

    # Both counts are minimums: threads keep being created until each target is
    # met. Capping thread length against a fixed message budget instead left the
    # message count short whenever the length draw ran long.
    while (
        len(world.email_threads) < world.scale.email_threads
        or len(world.email_messages) < world.scale.email_messages
    ):
        owner = rng.pick(owners)
        colleagues = [u for u in world.users_by_org.get(owner.organization_id, []) if u.id != owner.id]
        subject = rng.pick(catalog.EMAIL_SUBJECTS)
        folder = rng.weighted(catalog.EMAIL_FOLDERS)
        thread_start = rng.recent(days=60)
        in_thread = rng.weighted(((1, 0.42), (2, 0.28), (3, 0.16), (4, 0.09), (5, 0.05)))

        thread = EmailThread(
            id=rng.uuid(),
            subject=subject,
            folder=folder,
            owner_id=owner.id,
            organization_id=owner.organization_id,
            message_count=in_thread,
            labels=rng.sample(catalog.EMAIL_LABELS, rng.integer(0, 3)),
            is_starred=rng.chance(0.18),
            is_important=rng.chance(0.22),
            created_at=thread_start,
        )

        previous = None
        unread = 0
        has_attachments = False
        participants: dict = {}
        last_at = thread_start

        for position in range(in_thread):
            counter += 1
            outbound = folder == "SENT" or (position % 2 == 1)
            if outbound:
                sender_name, sender_email, sender_id = owner.full_name, owner.email, owner.id
            elif colleagues and rng.chance(0.6):
                person = rng.pick(colleagues)
                sender_name, sender_email, sender_id = person.full_name, person.email, person.id
            else:
                first = rng.pick(catalog.FIRST_NAMES)
                last = rng.pick(catalog.LAST_NAMES)
                domain = rng.pick(catalog.EXTERNAL_DOMAINS)
                sender_name = f"{first} {last}"
                sender_email = f"{slugify(first)}.{slugify(last)}@{domain}"
                sender_id = None

            sent_at = thread_start + timedelta(hours=position * rng.integer(2, 40))
            if sent_at > world.anchor:
                sent_at = world.anchor - timedelta(minutes=rng.integer(5, 600))
            last_at = max(last_at, sent_at)
            participants[sender_email] = sender_name

            body = "\n\n".join(rng.sample(catalog.EMAIL_PARAGRAPHS, rng.integer(1, 3)))
            is_draft = folder == "DRAFTS" and position == in_thread - 1
            is_read = outbound or is_draft or rng.chance(0.62)
            if not is_read:
                unread += 1
            attachment_count = rng.weighted(((0, 0.74), (1, 0.17), (2, 0.06), (3, 0.03)))
            has_attachments = has_attachments or attachment_count > 0

            message = EmailMessage(
                id=rng.uuid(),
                thread_id=thread.id,
                message_ref=f"<{rng.uuid().hex[:20]}.{counter}@nucleus.example>",
                subject=subject if position == 0 else f"Re: {subject}",
                from_name=sender_name,
                from_email=sender_email,
                to_recipients=[{"name": owner.full_name, "email": owner.email}]
                if not outbound
                else [{"name": p, "email": e} for e, p in list(participants.items())[:3]],
                cc_recipients=(
                    [{"name": c.full_name, "email": c.email} for c in rng.sample(colleagues, rng.integer(1, 2))]
                    if colleagues and rng.chance(0.25) else None
                ),
                body_html=f"<p>{body.replace(chr(10) + chr(10), '</p><p>')}</p>",
                body_text=body,
                preview=body[:200],
                folder=folder,
                is_read=is_read,
                is_starred=rng.chance(0.1),
                is_draft=is_draft,
                priority=rng.weighted(catalog.EMAIL_PRIORITIES),
                labels=thread.labels,
                sender_id=sender_id,
                owner_id=owner.id,
                sent_at=None if is_draft else sent_at,
                scheduled_for=rng.ahead(days_min=0, days_max=3) if is_draft and rng.chance(0.3) else None,
                read_at=rng.between(sent_at, world.anchor) if is_read and not is_draft else None,
                attachment_count=attachment_count,
                in_reply_to=previous.id if previous else None,
                created_at=sent_at,
            )
            world.email_messages.append(message)
            previous = message

            for _ in range(attachment_count):
                source = rng.pick(world.files) if world.files and rng.chance(0.6) else None
                extension, mime, _kind = rng.pick(catalog.FILE_TYPES)
                world.email_attachments.append(
                    EmailAttachment(
                        id=rng.uuid(),
                        message_id=message.id,
                        file_id=source.id if source else None,
                        name=source.name if source else f"{slugify(rng.pick(catalog.FILE_SUBJECTS))}.{extension}",
                        mime_type=source.mime_type if source else mime,
                        size_bytes=source.size_bytes if source else rng.integer(1_200, 6_000_000),
                        inline=rng.chance(0.15),
                        created_at=sent_at,
                    )
                )

        thread.unread_count = unread
        thread.has_attachments = has_attachments
        thread.last_message_at = last_at
        thread.snippet = (previous.preview or "")[:400] if previous else None
        thread.participants = [{"name": name, "email": email} for email, name in participants.items()]
        world.email_threads.append(thread)

    _cover_every_persona_inbox(world)
