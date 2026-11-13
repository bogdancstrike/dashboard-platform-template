"""The tag vocabulary: list, create, change."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.errors import ConflictError, ValidationError
from src.services.records.explorer import resources
from src.services.records.tags.checks import (
    CATEGORIES,
    MAX_PER_RECORD,
    _category,
    _colour,
    _description,
    _load,
    _name,
    _object,
    _serialize,
    _state,
    slugify,
)
from src.services.records.tags.derived import _resync_everything_tagged

#: Managing the vocabulary. Applying a tag is `records.update` — see above.
MANAGE_PERMISSION = "tags.manage"


APPLY_PERMISSION = "records.update"


def vocabulary(session, *, principal) -> dict[str, Any]:
    """Every tag, with how often it is used and who may change it."""
    from src.models.content import Tag

    rows = session.scalars(
        select(Tag).order_by(Tag.usage_count.desc(), Tag.name.asc())
    ).all()
    return {
        "items": [_serialize(tag) for tag in rows],
        "total": len(rows),
        "categories": [
            {"value": name, "count": sum(1 for tag in rows if tag.category == name)}
            for name in CATEGORIES
        ],
        # So the page can disable a control with a reason rather than hide one
        # and leave somebody wondering whether the feature exists (§76).
        "can_manage": principal.can(MANAGE_PERMISSION),
        "limit_per_record": MAX_PER_RECORD,
        "taggable": sorted(resources()),
    }


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Add a tag to the vocabulary."""
    from src.models.content import Tag

    principal.require(MANAGE_PERMISSION)
    body = _object(payload)
    name = _name(body.get("name"))
    slug = slugify(name)
    if not slug:
        raise ValidationError("A tag needs a name.", details={"field": "name"})

    existing = session.scalars(select(Tag).where(Tag.slug == slug)).first()
    if existing is not None:
        # Named, so the answer is "it is already there" rather than "no".
        raise ConflictError(
            f"“{existing.name}” already exists.",
            details={"slug": slug, "id": str(existing.id)},
        )

    tag = Tag(
        name=name,
        slug=slug,
        color=_colour(body.get("color")),
        description=_description(body.get("description")),
        category=_category(body.get("category")),
        created_by_id=principal.user_id,
        usage_count=0,
        is_system=False,
    )
    session.add(tag)
    session.flush()

    audit.record(
        session,
        action="CREATE",
        resource_type="tag",
        resource_id=tag.id,
        resource_label=tag.name,
        principal=principal,
        after=_state(tag),
        message=f"created the tag {tag.name}",
    )
    session.flush()
    return _serialize(tag)


def update(session, tag_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Rename, recolour or recategorise a tag.

    A rename rewrites the derived array on every record carrying it, which is
    the reason the links are the truth: without them a rename would be a
    thousand string replacements nobody could undo.
    """
    from src.models.content import Tag

    principal.require(MANAGE_PERMISSION)
    tag = _load(session, tag_id)
    body = _object(payload)
    before = _state(tag)

    if "name" in body:
        name = _name(body["name"])
        if tag.is_system and slugify(name) != tag.slug:
            # Its name is quoted by automations, saved searches and reports;
            # renaming it would silently change what those match.
            raise ValidationError(
                f"“{tag.name}” is a system tag and cannot be renamed. "
                "Its colour and description can be changed.",
                details={"id": str(tag.id), "is_system": True},
            )
        slug = slugify(name)
        clash = session.scalars(
            select(Tag).where(Tag.slug == slug, Tag.id != tag.id)
        ).first()
        if clash is not None:
            raise ConflictError(
                f"“{clash.name}” already uses that name.", details={"slug": slug}
            )
        tag.name = name
        tag.slug = slug
    if "color" in body:
        tag.color = _colour(body["color"])
    if "description" in body:
        tag.description = _description(body["description"])
    if "category" in body:
        tag.category = _category(body["category"])

    session.flush()
    after = _state(tag)
    if before != after:
        audit.record(
            session,
            action="UPDATE",
            resource_type="tag",
            resource_id=tag.id,
            resource_label=tag.name,
            principal=principal,
            before=before,
            after=after,
            message=f"changed the tag {tag.name}",
        )
        if before["name"] != after["name"]:
            _resync_everything_tagged(session, tag)
        session.flush()
    return _serialize(tag)
