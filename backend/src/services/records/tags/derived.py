"""Keeping the derived tags column and the counts in step."""

from __future__ import annotations

from sqlalchemy import func, select

from src.core.pagination import parse_uuid
from src.services.records.explorer import resources


def _resync(session, resource_type: str, resource_id: str) -> list[str]:
    """Rewrite one record's `tags` array from its links. The only writer.

    The array exists so a list can filter and draw tags without a join. It is
    a cache, in the same sense `Tag.usage_count` and `Project.task_count` are
    — and like those it has exactly one writer, a repair
    (`--sync-tags`) and an assertion in `--check`. Two *stores* for one fact is
    the mistake; one derived column with one writer is a decision.
    """
    from src.models.content import Tag, TagLink

    resource = resources().get(resource_type)
    if resource is None or not hasattr(resource.model, "tags"):
        return []

    names = sorted(
        session.scalars(
            select(Tag.name)
            .join(TagLink, TagLink.tag_id == Tag.id)
            .where(
                TagLink.resource_type == resource_type,
                TagLink.resource_id == str(resource_id),
            )
        ).all()
    )
    row = session.get(resource.model, parse_uuid(resource_id, field="resource_id"))
    if row is not None:
        row.tags = names or None
    return names


def _resync_everything_tagged(session, tag) -> int:
    """Rewrite the array wherever this tag appears. Used after a rename."""
    from src.models.content import TagLink

    links = session.scalars(select(TagLink).where(TagLink.tag_id == tag.id)).all()
    for link in links:
        _resync(session, link.resource_type, link.resource_id)
    return len(links)


def _recount(session, tag) -> int:
    """Recompute one tag's usage. Cheap, and the manager sorts by it."""
    from src.models.content import TagLink

    tag.usage_count = int(
        session.scalar(
            select(func.count()).select_from(TagLink).where(TagLink.tag_id == tag.id)
        )
        or 0
    )
    return tag.usage_count
