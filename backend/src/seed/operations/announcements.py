"""Seed data for operations: _announcements."""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.operations.scheduled_tasks import _role_code
from src.seed.world import World


def _announcements(world: World) -> None:
    """Notices in every state a reader or an author can encounter.

    Deliberately spread across the lifecycle rather than all published: the
    author's list is a page too, and a dataset where every notice is live
    cannot demonstrate a draft, a schedule or an expiry. What the *reader's*
    page shows is then a genuine subset, which is the point — a seed where
    every row passes the filter proves the filter untested.
    """
    from src.models.platform import Announcement, AnnouncementReceipt

    rng = world.rng.derive("announcements")
    if not world.users:
        return

    author = world.personas.get("ADMINISTRATOR") or world.users[0]
    organization_id = author.organization_id
    audiences: tuple[tuple[list[str], float], ...] = (
        # Most notices are for everybody — that is what a notice is.
        ([], 0.7),
        (["MANAGER", "ADMINISTRATOR"], 0.2),
        (["VIEWER"], 0.1),
    )

    for index in range(world.scale.announcements):
        title, category, severity, body = catalog.ANNOUNCEMENTS[
            index % len(catalog.ANNOUNCEMENTS)
        ]
        if index >= len(catalog.ANNOUNCEMENTS):
            title = f"{title} ({index // len(catalog.ANNOUNCEMENTS) + 1})"

        # Every state is *guaranteed* for the first four, then weighted for
        # the rest. Left to chance alone, a small-scale dataset produced no
        # expired notice and no draft at all — and a demo where a state cannot
        # be seen is a demo of a page whose filter has never been used.
        state = (
            ("PUBLISHED", "EXPIRED", "SCHEDULED", "DRAFT")[index]
            if index < 4
            else rng.weighted(
                (("PUBLISHED", 0.6), ("EXPIRED", 0.2), ("SCHEDULED", 0.1), ("DRAFT", 0.1))
            )
        )
        if state == "DRAFT":
            status, publish_at, expires_at = "DRAFT", None, None
        elif state == "SCHEDULED":
            status = "SCHEDULED"
            publish_at = rng.between(world.anchor, world.anchor + timedelta(days=14))
            expires_at = publish_at + timedelta(days=rng.integer(7, 30))
        elif state == "EXPIRED":
            status = "PUBLISHED"
            publish_at = rng.ago(days_min=60, days_max=200)
            expires_at = publish_at + timedelta(days=rng.integer(3, 21))
        else:
            status = "PUBLISHED"
            publish_at = rng.recent(days=45)
            # Half of the live ones never expire: a policy is not a window.
            expires_at = (
                publish_at + timedelta(days=rng.integer(20, 120)) if rng.chance(0.5) else None
            )

        roles = rng.weighted(audiences)
        # A critical notice asks to be acknowledged; a release does not.
        requires_ack = severity == "CRITICAL" or (category == "POLICY" and rng.chance(0.5))

        announcement = Announcement(
            id=rng.uuid(),
            title=title,
            body=body,
            category=category,
            severity=severity,
            status=status,
            publish_at=publish_at,
            expires_at=expires_at,
            audience_roles=list(roles),
            # Left open to every tenant most of the time: a platform notice is
            # a platform notice.
            organization_id=None if rng.chance(0.7) else organization_id,
            requires_acknowledgement=requires_ack,
            # Pinned below, once it is known which one is newest and live: a
            # list where everything is pinned has nothing pinned.
            is_pinned=False,
            link="/settings/system" if category == "MAINTENANCE" else None,
            author_id=author.id,
            author_label=author.full_name,
            created_at=publish_at or rng.ago(days_min=1, days_max=30),
        )
        world.announcements.append(announcement)

        if status != "PUBLISHED":
            continue

        # Receipts for some of the people it reached. Written on the reader's
        # action in the product, so the seed writes them for *some* readers
        # only — a notice everybody has read cannot demonstrate an unread one.
        readers = [
            user
            for user in ([*world.personas.values()] * 2 + world.users)
            if not roles or _role_code(world, user) in roles
        ]
        for user in {user.id: user for user in readers}.values():
            if not rng.chance(0.55):
                continue
            read_at = rng.between(publish_at, world.anchor)
            world.announcement_receipts.append(
                AnnouncementReceipt(
                    id=rng.uuid(),
                    announcement_id=announcement.id,
                    user_id=user.id,
                    read_at=read_at,
                    # Fewer acknowledge than read, which is the whole reason
                    # they are two columns.
                    acknowledged_at=(
                        rng.between(read_at, world.anchor)
                        if requires_ack and rng.chance(0.6)
                        else None
                    ),
                    created_at=read_at,
                )
            )

    # Exactly one pin, on the newest live notice. Decided after the loop
    # because "the newest live one" is not knowable while building them.
    live = [
        item
        for item in world.announcements
        if item.status == "PUBLISHED"
        and item.publish_at is not None
        and (item.expires_at is None or item.expires_at > world.anchor)
    ]
    if live:
        max(live, key=lambda item: item.publish_at).is_pinned = True
