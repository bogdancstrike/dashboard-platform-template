"""Tag limits and categories, the checks a tag passes, and a tag as the API returns it."""

from __future__ import annotations

import re
from typing import Any

from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404

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

    tag = get_or_404(
        session,
        Tag,
        parse_uuid(tag_id, field="tag_id"),
        "That tag does not exist.",
        details={"id": str(tag_id)},
    )
    return tag


def _record(session, resource, identifier):
    from src.services.records.detail import _lookup

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
