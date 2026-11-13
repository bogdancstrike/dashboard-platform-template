"""Removing a tag, and the tags on one record."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.records.explorer import resource_for
from src.services.records.tags.checks import (
    MAX_PER_RECORD,
    _load,
    _record,
    _serialize,
    _wanted,
)
from src.services.records.tags.derived import _recount, _resync
from src.services.records.tags.tag_admin import (
    APPLY_PERMISSION,
    MANAGE_PERMISSION,
)


def remove(session, tag_id: Any, *, principal) -> dict[str, Any]:
    """Delete a tag and take it off everything it was on."""
    from src.models.content import TagLink

    principal.require(MANAGE_PERMISSION)
    tag = _load(session, tag_id)
    if tag.is_system:
        raise ValidationError(
            f"“{tag.name}” is a system tag and cannot be removed. "
            "Automations and saved searches quote it by name.",
            details={"id": str(tag.id), "is_system": True},
        )

    links = session.scalars(select(TagLink).where(TagLink.tag_id == tag.id)).all()
    touched = [(link.resource_type, link.resource_id) for link in links]
    label = tag.name

    for link in links:
        session.delete(link)
    session.delete(tag)
    session.flush()

    # The array on each record is a cache of the links, so it has to be
    # rewritten wherever one went — otherwise a deleted tag stays on the lists
    # forever, which is the failure mode of a denormalised column with no
    # single writer.
    for resource_type, resource_id in touched:
        _resync(session, resource_type, resource_id)

    audit.record(
        session,
        action="DELETE",
        resource_type="tag",
        resource_id=tag_id,
        resource_label=label,
        principal=principal,
        before={"name": label},
        after={"deleted": True},
        message=f"removed the tag {label} from {len(touched)} records",
        metadata={"records": len(touched)},
    )
    session.flush()
    return {"id": str(tag_id), "deleted": True, "name": label, "records": len(touched)}


def on_record(session, resource_type: Any, resource_id: Any, *, principal) -> dict[str, Any]:
    """The tags a record carries, and whether this reader may change them."""
    from src.models.content import Tag, TagLink

    resource = resource_for(resource_type, principal=principal)
    identifier = str(parse_uuid(resource_id, field="resource_id"))

    rows = session.scalars(
        select(Tag)
        .join(TagLink, TagLink.tag_id == Tag.id)
        .where(TagLink.resource_type == resource.key, TagLink.resource_id == identifier)
        .order_by(Tag.name.asc())
    ).all()
    return {
        "resource_type": resource.key,
        "resource_id": identifier,
        "items": [_serialize(tag) for tag in rows],
        "can_apply": principal.can(APPLY_PERMISSION),
        "limit": MAX_PER_RECORD,
    }


def apply(
    session, resource_type: Any, resource_id: Any, payload: Any, *, principal
) -> dict[str, Any]:
    """Set the tags on one record — the whole set, in one call.

    Never add-one and remove-one. Two people editing the same record's tags
    with those would interleave into a set neither of them chose, and each
    would see their own change land and the other's vanish.

    Tags may be named that do not exist yet; they are *not* created here. A
    typo would otherwise become a permanent member of a shared vocabulary,
    which is exactly what having a vocabulary is meant to prevent.
    """
    from src.models.content import Tag, TagLink

    resource = resource_for(resource_type, principal=principal)
    principal.require(APPLY_PERMISSION)
    identifier = parse_uuid(resource_id, field="resource_id")
    row = _record(session, resource, identifier)

    wanted = _wanted(payload)
    known = (
        {tag.slug: tag for tag in session.scalars(select(Tag).where(Tag.slug.in_(wanted))).all()}
        if wanted
        else {}
    )
    unknown = [slug for slug in wanted if slug not in known]
    if unknown:
        raise ValidationError(
            "Those tags do not exist. Add them to the vocabulary first.",
            details={"unknown": unknown, "field": "tags"},
        )

    links = session.scalars(
        select(TagLink).where(
            TagLink.resource_type == resource.key,
            TagLink.resource_id == str(identifier),
        )
    ).all()
    was = sorted(link.tag.name for link in links if link.tag is not None)

    # Every tag whose count this gesture could move: the ones losing a link and
    # the ones gaining one. Collected before the deletes, because a deleted
    # link cannot be asked what it pointed at.
    touched = {link.tag for link in links if link.tag is not None}
    touched.update(known.values())

    keep = {known[slug].id for slug in wanted}
    held = {link.tag_id for link in links}
    for link in links:
        if link.tag_id not in keep:
            session.delete(link)
    for slug in wanted:
        tag = known[slug]
        if tag.id not in held:
            session.add(
                TagLink(
                    tag_id=tag.id,
                    resource_type=resource.key,
                    resource_id=str(identifier),
                    assigned_by_id=principal.user_id,
                )
            )
    session.flush()

    names = _resync(session, resource.key, str(identifier))
    for tag in touched:
        _recount(session, tag)
    session.flush()

    if was != names:
        # Audited as a change to the *record*, because that is what it is: the
        # record's classification moved, and it belongs on that record's own
        # history beside every other edit (§21).
        audit.record(
            session,
            action="UPDATE",
            resource_type=resource.key,
            resource_id=identifier,
            resource_label=resource.label_for(row),
            principal=principal,
            before={"tags": was},
            after={"tags": names},
            message=f"retagged {resource.label_for(row)}",
        )
        session.flush()

    return on_record(session, resource.key, identifier, principal=principal)
