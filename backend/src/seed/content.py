"""Files, folders, the mailbox, comments and tags.

The mailbox is threads *and* messages, because threading is the only thing that
makes an inbox screen non-trivial and therefore the only reason to have one in
a template. Messages within a thread are appended in send order and reply to
the message before them, so `in_reply_to` never points at a row that does not
exist yet.
"""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.support import checksum_of, reference, slugify
from src.seed.world import World

RESOURCE_TYPES = ("project", "task", "ticket", "customer", "order", "device", "file")


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

    while len(world.folders) < world.scale.folders and roots:
        parent = rng.pick(roots)
        name = rng.pick(("2024", "2025", "2026", "Drafts", "Approved", "Signed", "Inbound", "Outbound"))
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


def _files(world: World) -> None:
    from src.models.content import FileObject

    rng = world.rng.derive("files")
    if not world.folders:
        return

    tasks_by_project: dict = {}
    for task in world.tasks:
        tasks_by_project.setdefault(task.project_id, []).append(task)

    counts: dict = {}
    sizes: dict = {}

    for index in range(world.scale.files):
        folder = rng.pick(world.folders)
        extension, mime, kind = rng.pick(catalog.FILE_TYPES)
        subject = rng.pick(catalog.FILE_SUBJECTS)
        name = f"{subject} {rng.integer(2024, 2026)}-{rng.integer(1, 12):02d}.{extension}"
        size = rng.integer(2_400, 18_000_000)
        members = world.users_by_org.get(folder.organization_id, [])
        project_id = folder.project_id
        tasks = tasks_by_project.get(project_id, []) if project_id else []
        created = rng.between(folder.created_at, world.anchor)

        world.files.append(
            FileObject(
                id=rng.uuid(),
                name=name,
                extension=extension,
                mime_type=mime,
                kind=kind,
                size_bytes=size,
                checksum=checksum_of(name, size, index)[:64],
                storage_key=f"{folder.path.lstrip('/')}/{slugify(subject)}-{index}.{extension}",
                folder_id=folder.id,
                organization_id=folder.organization_id,
                project_id=project_id,
                task_id=rng.pick(tasks).id if tasks and rng.chance(0.25) else None,
                owner_id=rng.pick(members).id if members else folder.owner_id,
                status=rng.weighted((("READY", 0.9), ("PROCESSING", 0.05), ("QUARANTINED", 0.03), ("FAILED", 0.02))),
                visibility=rng.weighted((("PRIVATE", 0.35), ("TEAM", 0.35), ("ORGANIZATION", 0.24), ("PUBLIC", 0.06))),
                version=rng.weighted(((1, 0.7), (2, 0.17), (3, 0.08), (rng.integer(4, 12), 0.05))),
                download_count=rng.integer(0, 340),
                last_accessed_at=rng.maybe(rng.recent(days=90), 0.75),
                # A text preview so the split view (§63) can render without
                # fetching the blob — which for most of these does not exist.
                preview_text=(
                    f"{subject}\n\nPrepared for {folder.name.lower()}. "
                    "Figures are provisional until the reconciliation completes."
                    if kind in ("DOCUMENT", "DATA", "LOG") else None
                ),
                tags=rng.sample([t[0] for t in catalog.TAGS], rng.integer(0, 3)),
                created_at=created,
                metadata_json={"source": rng.pick(("upload", "import", "generated"))},
            )
        )
        counts[folder.id] = counts.get(folder.id, 0) + 1
        sizes[folder.id] = sizes.get(folder.id, 0) + size

    for folder in world.folders:
        folder.file_count = counts.get(folder.id, 0)
        folder.total_size = sizes.get(folder.id, 0)


def _email_templates(world: World) -> None:
    from src.models.content import EmailTemplate

    rng = world.rng.derive("email-templates")
    for code, name, category, subject in catalog.EMAIL_TEMPLATES:
        variables = sorted({
            part.split("}}")[0].strip()
            for part in subject.split("{{")[1:]
        })
        world.email_templates.append(
            EmailTemplate(
                id=rng.uuid(),
                code=code,
                name=name,
                description=f"{name} sent by the platform.",
                category=category,
                subject=subject,
                body_html=(
                    f"<p>Hello {{{{recipient}}}},</p><p>{name} for {{{{app_name}}}}.</p>"
                    "<p>— The {{app_name}} team</p>"
                ),
                body_text=f"Hello {{{{recipient}}}},\n\n{name} for {{{{app_name}}}}.\n",
                locale="en-US",
                is_active=rng.chance(0.88),
                variables=variables + ["recipient", "app_name"],
                updated_by_id=rng.pick(world.users).id if world.users else None,
                last_sent_at=rng.maybe(rng.recent(days=30), 0.7),
                send_count=rng.integer(0, 12_000),
                created_at=rng.ago(days_min=120, days_max=700),
            )
        )


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
                priority=rng.weighted((("NORMAL", 0.82), ("HIGH", 0.13), ("LOW", 0.05))),
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


def _tag_links(world: World) -> None:
    """Attach tags to records, keeping `usage_count` honest.

    The counter exists so the tag manager can sort by popularity without a
    `count(*)` per row, which makes it worth exactly as much as its accuracy.
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
