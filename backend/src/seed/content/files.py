"""Seed data for content: _email_templates, _files."""

from __future__ import annotations

from src.seed import catalog
from src.seed.support import checksum_of, slugify
from src.seed.world import World


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
