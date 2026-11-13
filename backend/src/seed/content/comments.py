"""Seed data for content: _comments, _folders."""

from __future__ import annotations

from src.seed import catalog
from src.seed.content.inbox import SUBFOLDER_NAMES
from src.seed.support import slugify
from src.seed.world import World


def _folders(world: World) -> None:
    """A two-level tree with a materialised `path`.

    The path is stored rather than walked so a breadcrumb is one row read; it
    is only trustworthy if the seed builds it the same way the API will.
    """
    from src.models.content import Folder

    rng = world.rng.derive("folders")
    roots: list = []

    for name in catalog.FOLDER_NAMES:
        organization = rng.pick(world.organizations)
        members = world.users_by_org.get(organization.id, [])
        folder = Folder(
            id=rng.uuid(),
            name=name,
            path=f"/{slugify(name)}",
            organization_id=organization.id,
            owner_id=rng.pick(members).id if members else None,
            is_shared=rng.chance(0.45),
            color=rng.maybe(rng.pick(("#5b5bd6", "#0891b2", "#16a34a", "#ca8a04")), 0.5),
            created_at=rng.ago(days_min=60, days_max=900),
        )
        world.folders.append(folder)
        roots.append(folder)

    projects_by_org: dict = {}
    for project in world.projects:
        projects_by_org.setdefault(project.organization_id, []).append(project)

    # One name per parent: three sibling folders all called "2024" read as a
    # broken tree (audit A). Bounded, so a small scale with few roots cannot
    # spin once every parent has used every name.
    taken: set[tuple] = set()
    attempts = 0
    while len(world.folders) < world.scale.folders and roots and attempts < world.scale.folders * 20:
        attempts += 1
        parent = rng.pick(roots)
        name = rng.pick(SUBFOLDER_NAMES)
        if (parent.id, name) in taken:
            continue
        taken.add((parent.id, name))
        projects = projects_by_org.get(parent.organization_id, [])
        world.folders.append(
            Folder(
                id=rng.uuid(),
                name=name,
                path=f"{parent.path}/{slugify(name)}",
                parent_id=parent.id,
                organization_id=parent.organization_id,
                project_id=rng.pick(projects).id if projects and rng.chance(0.3) else None,
                owner_id=parent.owner_id,
                is_shared=parent.is_shared,
                created_at=rng.between(parent.created_at, world.anchor),
            )
        )


def _comments(world: World) -> None:
    """Polymorphic comments, with a slice of them as replies.

    Roots are appended before replies for the same reason tasks are: the
    self-referencing foreign key is checked at insert time.
    """
    from src.models.content import Comment

    rng = world.rng.derive("comments")
    if not world.users:
        return

    targets: list[tuple[str, object, str]] = []
    for project in world.projects:
        targets.append(("project", project.id, project.name))
    for task in world.tasks:
        targets.append(("task", task.id, task.title))
    for ticket in world.tickets:
        targets.append(("ticket", ticket.id, ticket.subject))
    for customer in world.customers:
        targets.append(("customer", customer.id, customer.name))
    if not targets:
        return

    roots: list = []
    reply_budget = world.scale.comments // 4

    while len(world.comments) < world.scale.comments - reply_budget:
        resource_type, resource_id, _label = rng.pick(targets)
        author = rng.pick(world.users)
        mentioned = rng.sample(world.users, rng.weighted(((0, 0.78), (1, 0.16), (2, 0.06))))
        created = rng.recent(days=120)
        comment = Comment(
            id=rng.uuid(),
            resource_type=resource_type,
            resource_id=str(resource_id),
            author_id=author.id,
            body=rng.pick(catalog.COMMENT_BODIES),
            mentions=[str(person.id) for person in mentioned] or None,
            reactions=(
                {rng.pick(("👍", "🎉", "👀", "✅")): [str(rng.pick(world.users).id)]}
                if rng.chance(0.28) else None
            ),
            edited_at=rng.between(created, world.anchor) if rng.chance(0.1) else None,
            is_internal=rng.chance(0.3),
            is_pinned=rng.chance(0.05),
            created_at=created,
        )
        world.comments.append(comment)
        roots.append(comment)

    while len(world.comments) < world.scale.comments and roots:
        parent = rng.pick(roots)
        world.comments.append(
            Comment(
                id=rng.uuid(),
                resource_type=parent.resource_type,
                resource_id=parent.resource_id,
                parent_id=parent.id,
                author_id=rng.pick(world.users).id,
                body=rng.pick(catalog.COMMENT_BODIES),
                is_internal=parent.is_internal,
                created_at=rng.between(parent.created_at, world.anchor),
            )
        )
