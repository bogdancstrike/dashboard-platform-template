"""Seed data for content: build, dedupe_folders."""

from __future__ import annotations

from src.seed import catalog
from src.seed.content.comments import _comments, _folders
from src.seed.content.files import _email_templates, _files
from src.seed.content.inbox import SUBFOLDER_NAMES
from src.seed.content.mailbox import _mailbox
from src.seed.support import slugify
from src.seed.world import World


def build(world: World) -> None:
    _tags(world)
    _folders(world)
    _files(world)
    _email_templates(world)
    _mailbox(world)
    _comments(world)
    _tag_links(world)


def _tags(world: World) -> None:
    from src.models.content import Tag

    rng = world.rng.derive("tags")
    for name, color, category in catalog.TAGS:
        world.tags.append(
            Tag(
                id=rng.uuid(),
                name=name,
                slug=slugify(name),
                color=color,
                description=f"{name.replace('-', ' ').capitalize()}.",
                category=category,
                organization_id=world.organizations[0].id if world.organizations else None,
                created_by_id=rng.pick(world.users).id if world.users else None,
                is_system=category in ("PRIORITY", "GOVERNANCE"),
                created_at=rng.ago(days_min=90, days_max=800),
            )
        )


def _tag_links(world: World) -> None:
    """Attach tags to records, keeping `usage_count` honest.

    The counter exists so the tag manager can sort by popularity without a
    `count(*)` per row, which makes it worth exactly as much as its accuracy.

    **The only writer of a tag fact in the seed.** The entity generators used
    to fill each record's `tags` array *as well*, from an independent draw —
    two writers producing two unrelated answers, which is how 44 tagged tasks
    and 28 tag links came to disagree. `services/tags` treats the links as the
    truth and the array as a derived cache; `runner.sync_tags` derives it after
    the seed, and `--check` asserts the two agree.
    """
    from src.models.content import TagLink

    rng = world.rng.derive("tag-links")
    if not world.tags:
        return

    targets: list[tuple[str, object]] = []
    for project in world.projects:
        targets.append(("project", project.id))
    for task in world.tasks:
        targets.append(("task", task.id))
    for ticket in world.tickets:
        targets.append(("ticket", ticket.id))
    for customer in world.customers:
        targets.append(("customer", customer.id))
    for file_object in world.files:
        targets.append(("file", file_object.id))
    if not targets:
        return

    usage: dict = {}
    # The unique constraint is (tag, resource_type, resource_id), so pairs are
    # tracked rather than trusted to chance.
    seen: set[tuple] = set()

    attempts = 0
    while len(world.tag_links) < world.scale.tag_links and attempts < world.scale.tag_links * 6:
        attempts += 1
        tag = rng.pick(world.tags)
        resource_type, resource_id = rng.pick(targets)
        key = (tag.id, resource_type, str(resource_id))
        if key in seen:
            continue
        seen.add(key)
        world.tag_links.append(
            TagLink(
                id=rng.uuid(),
                tag_id=tag.id,
                resource_type=resource_type,
                resource_id=str(resource_id),
                assigned_by_id=rng.pick(world.users).id if world.users else None,
                created_at=rng.recent(days=180),
            )
        )
        usage[tag.id] = usage.get(tag.id, 0) + 1

    for tag in world.tags:
        tag.usage_count = usage.get(tag.id, 0)


def dedupe_folders(session) -> dict[str, int]:
    """Rename sibling folders that share a name, for a database seeded before
    the seed kept one name per parent. Renamed to a name that parent does not
    use yet (and its path with it); files stay where they are."""
    from sqlalchemy import select

    from src.models.content import Folder

    renamed = 0
    folders = list(session.scalars(select(Folder).where(Folder.parent_id.is_not(None))))
    by_parent: dict = {}
    for folder in sorted(folders, key=lambda f: (str(f.parent_id), str(f.created_at), str(f.id))):
        by_parent.setdefault(folder.parent_id, []).append(folder)
    for siblings in by_parent.values():
        used = {f.name for f in siblings}
        seen: set[str] = set()
        for folder in siblings:
            if folder.name not in seen:
                seen.add(folder.name)
                continue
            spare = next((n for n in SUBFOLDER_NAMES if n not in used), None)
            if spare is None:
                index = 2
                while f"{folder.name} ({index})" in used:
                    index += 1
                spare = f"{folder.name} ({index})"
            base = folder.path.rsplit("/", 1)[0] if folder.path else ""
            folder.name = spare
            folder.path = f"{base}/{slugify(spare)}"
            used.add(spare)
            seen.add(spare)
            renamed += 1
    session.flush()
    return {"renamed": renamed}
