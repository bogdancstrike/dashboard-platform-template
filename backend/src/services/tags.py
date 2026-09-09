"""Tags — one shared vocabulary, applied to anything (§37).

A tag is the only piece of classification a *reader* gets to invent. Every other
way this platform describes a record — status, priority, health, category — is a
closed vocabulary somebody declared in code, because a filter menu built from
free text is a filter menu with four spellings of "urgent" in it. Tags are the
deliberate exception, and the price of the exception is that the vocabulary has
to be *managed*: curated in one place, renamed once rather than per record, and
removable.

Four decisions carry this module.

**`TagLink` is the truth; the entity's `tags` array is a derived cache with one
writer.** Both existed before this module and nothing kept them in step: 44
tasks carried an array and 28 had links, and there was no reason to think the
two sets agreed. That is the same defect the favourites work found — two stores
for one fact, and the one anybody would act on is whichever they had not looked
at. The links win, because they carry who assigned a tag and when, they cascade
when a tag is deleted, and a tag renamed does not leave stale strings on a
thousand records. The array is kept because it is what makes a list filterable
without a join, written *only* by `_resync` here, repaired by
`python -m src.seed --sync-tags` and asserted by `--check` — the same pattern
`Tag.usage_count` and `Project.task_count` already use.

**A record's tags are set as a whole set, never added one at a time.** Two
people editing the same record's tags with add/remove calls interleave into a
set neither of them chose. One gesture, one call, one audit row.

**Applying a tag is an edit; managing the vocabulary is governance.** Putting a
tag on a record needs `records.update` — it is a change to that record and it is
audited as one. Creating, renaming, recolouring or deleting a tag changes what
*every* record carrying it says, so it needs `tags.manage`.

**A system tag can be recoloured and described but not renamed or removed.** Its
name is quoted by automations, saved searches and reports; renaming it would
silently change what those match, and deleting it would silently match nothing.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.explorer import resource_for, resources

#: Managing the vocabulary. Applying a tag is `records.update` — see above.
MANAGE_PERMISSION = "tags.manage"
APPLY_PERMISSION = "records.update"

#: What a tag may be called, and how long.
#:
#: Short on purpose: a tag is read in a row of six of them beside a record's
#: title, and a forty-character tag is a sentence pretending to be a label.
MAX_NAME = 48
MAX_DESCRIPTION = 240

#: The most tags one record may carry.
#:
#: Not a storage limit. Twelve tags on a record is a record nobody can scan,
#: and a tag that appears on everything has stopped classifying anything.
MAX_PER_RECORD = 12

#: The categories the manager groups by. A closed set, because the whole point
#: of a category is that two people filing a tag reach for the same one.
CATEGORIES = ("GENERAL", "PRIORITY", "STATUS", "REGION", "GOVERNANCE", "ENGINEERING")


def slugify(name: str) -> str:
    """The stable identity behind a display name.

    "Urgent", "urgent" and " URGENT " are one tag. Without this the vocabulary
    is decoration: a filter for one of the spellings finds a third of the rows
    and reports it as all of them.
    """
    cleaned = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")
    return cleaned[:MAX_NAME]


# ── the vocabulary ───────────────────────────────────────────────────────


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


def remove(session, tag_id: Any, *, principal) -> dict[str, Any]:
    """Delete a tag and take it off everything it was on."""
    from src.models.content import Tag, TagLink

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


# ── tags on one record ───────────────────────────────────────────────────


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


# ── the derived column ───────────────────────────────────────────────────


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


# ── parsing ──────────────────────────────────────────────────────────────


def _object(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The tag must be a JSON object.")
    return payload


def _wanted(payload: Any) -> list[str]:
    """The slugs a request asks for: cleaned, de-duplicated, order irrelevant."""
    raw = payload.get("tags") if isinstance(payload, dict) else payload
    if raw is None:
        raw = []
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("tags must be a list of names.", details={"field": "tags"})

    slugs: list[str] = []
    for item in raw:
        slug = slugify(item)
        if slug and slug not in slugs:
            slugs.append(slug)
    if len(slugs) > MAX_PER_RECORD:
        raise ValidationError(
            f"{len(slugs)} tags is more than {MAX_PER_RECORD} on one record. "
            "A tag that appears on everything has stopped classifying anything.",
            details={"tags": len(slugs), "limit": MAX_PER_RECORD},
        )
    return slugs


def _name(raw: Any) -> str:
    name = str(raw or "").strip()
    if not name:
        raise ValidationError("A tag needs a name.", details={"field": "name"})
    if len(name) > MAX_NAME:
        raise ValidationError(
            f"A tag name is at most {MAX_NAME} characters.",
            details={"field": "name", "limit": MAX_NAME},
        )
    return name


def _description(raw: Any) -> str | None:
    text = str(raw or "").strip()
    if len(text) > MAX_DESCRIPTION:
        raise ValidationError(
            f"A description is at most {MAX_DESCRIPTION} characters.",
            details={"field": "description", "limit": MAX_DESCRIPTION},
        )
    return text or None


def _colour(raw: Any) -> str:
    value = str(raw or "").strip() or "#64748b"
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValidationError(
            "A colour is a six-digit hex value like #dc2626.",
            details={"field": "color", "value": value},
        )
    return value.lower()


def _category(raw: Any) -> str:
    value = str(raw or "GENERAL").strip().upper()
    if value not in CATEGORIES:
        raise ValidationError(
            f"{value!r} is not a tag category; use one of " + ", ".join(CATEGORIES),
            details={"field": "category", "allowed": list(CATEGORIES)},
        )
    return value


def _load(session, tag_id: Any):
    from src.models.content import Tag

    tag = session.get(Tag, parse_uuid(tag_id, field="tag_id"))
    if tag is None:
        raise NotFoundError("That tag does not exist.", details={"id": str(tag_id)})
    return tag


def _record(session, resource, identifier):
    from src.services.records import _lookup

    row = session.scalars(_lookup(resource, identifier)).first()
    if row is None:
        raise NotFoundError(
            f"That {resource.label.rstrip('s').lower()} does not exist.",
            details={"resource_type": resource.key, "id": str(identifier)},
        )
    return row


def _state(tag) -> dict[str, Any]:
    return {
        "name": tag.name,
        "slug": tag.slug,
        "color": tag.color,
        "category": tag.category,
        "description": tag.description or "",
    }


def _serialize(tag) -> dict[str, Any]:
    return {
        "id": str(tag.id),
        "name": tag.name,
        "slug": tag.slug,
        "color": tag.color,
        "description": tag.description or "",
        "category": tag.category,
        "usage_count": int(tag.usage_count or 0),
        # A system tag may be recoloured and described but not renamed or
        # removed; the page needs to know which before it offers the control.
        "is_system": bool(tag.is_system),
    }
