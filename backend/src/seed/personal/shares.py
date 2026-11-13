"""Seed data for personal: _shares."""

from __future__ import annotations

from src.seed.world import World


def _shares(world: World) -> None:
    """Members on the saved searches whose scope is SHARED (§5).

    Only SHARED searches get rows: a private one has no audience, and a public
    one needs none. Rows are kept when a search is flipped to PUBLIC and back,
    but the seed has no history to preserve, so it only fills the SHARED ones.

    The personas are over-represented as *recipients* — a sharing screen that
    shows nothing shared *with you* on the account everyone signs in as
    demonstrates half the feature.
    """
    from src.models.personal import ResourceShare

    rng = world.rng.derive("shares")
    personas = list(world.personas.values())
    if not world.users:
        return

    seen: set[tuple[str, str]] = set()
    for search in world.saved_searches:
        if search.scope != "SHARED":
            continue
        candidates = [u for u in world.users if u.id != search.owner_id]
        if not candidates:
            continue
        recipients = rng.sample(candidates, rng.integer(1, 4))
        # Make sure a persona other than the owner can see some of these.
        for persona in personas:
            if persona.id != search.owner_id and rng.chance(0.4):
                recipients.append(persona)

        for recipient in recipients:
            key = (str(search.id), str(recipient.id))
            if key in seen:
                continue
            seen.add(key)
            world.resource_shares.append(
                ResourceShare(
                    id=rng.uuid(),
                    resource_type="saved_search",
                    resource_id=str(search.id),
                    user_id=recipient.id,
                    shared_by_id=search.owner_id,
                    # Read only, always. Editing belongs to the owner (§5).
                    permission="VIEW",
                    created_at=rng.between(search.created_at, world.anchor),
                )
            )
