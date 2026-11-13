"""Repairing mailboxes."""

from __future__ import annotations


def sync_mailboxes(session) -> dict[str, int]:
    """Give each demo persona an inbox worth opening, without reseeding.

    The third of these repairs, and the same shape as the other two: targeted,
    idempotent, and additive. It exists because the mailbox generator's folder
    draw is random and its own docstring promises something it did not always
    deliver — at the small scale the *administrator*, the account everybody
    signs in as first, ended up with two threads and neither in the inbox. An
    empty inbox on a demo reads as a broken feature.

    Idempotent because it counts what is already there: run twice and the
    second run adds nothing. Additive because it only inserts — a mailbox
    somebody has been reading is not touched, and mail they filed elsewhere
    stays filed.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.core.clock import now
    from src.models.content import EmailThread
    from src.models.identity import User
    from src.seed.content import GUARANTEED_INBOX, inbox_thread
    from src.seed.support import Rng

    anchor = now()
    # Seeded from the clock, not from a constant. The *seed* is reproducible on
    # purpose; a repair writing into a live database must not be — a fixed seed
    # regenerates the same UUIDs, so a second run that finds one persona short
    # collides with the rows the first run wrote for another.
    rng = Rng(int(anchor.timestamp() * 1000), anchor).derive("mailbox-topup")
    personas = session.scalars(
        _select(User).where(
            User.username.in_(("admin", "manager", "operator", "analyst", "user")),
            User.deleted_at.is_(None),
        )
    ).all()

    counted = dict(
        session.execute(
            _select(EmailThread.owner_id, func.count())
            .where(
                EmailThread.folder == "INBOX",
                EmailThread.deleted_at.is_(None),
            )
            .group_by(EmailThread.owner_id)
        ).all()
    )

    added = 0
    for owner in personas:
        colleagues = session.scalars(
            _select(User)
            .where(
                User.organization_id == owner.organization_id,
                User.id != owner.id,
                User.deleted_at.is_(None),
            )
            .limit(12)
        ).all()
        missing = max(0, GUARANTEED_INBOX - int(counted.get(owner.id, 0)))
        for index in range(missing):
            added += 1
            sender = rng.pick(colleagues) if colleagues else owner
            thread, message = inbox_thread(rng, owner, sender, anchor, index, added)
            session.add(thread)
            session.add(message)

    session.flush()
    return {"added": added, "personas": len(personas)}
