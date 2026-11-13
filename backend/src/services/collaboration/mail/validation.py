"""A message, its recipients and labels, checked."""

from __future__ import annotations

from typing import Any

from src.core.errors import ValidationError
from src.core.vocabulary import EMAIL_FOLDER, EMAIL_PRIORITY
from src.services.collaboration.mail.mail_templates import _rendered, _template_row
from src.services.collaboration.mail.rows import (
    _EMAIL,
    MAX_BODY,
    MAX_LABELS,
    MAX_RECIPIENTS,
    MAX_SUBJECT,
    MOVABLE,
)


def _validated_message(
    session, data: dict[str, Any], *, partial: bool = False
) -> dict[str, Any]:
    values: dict[str, Any] = {}

    if "subject" in data or not partial:
        values["subject"] = str(data.get("subject") or "").strip()[:MAX_SUBJECT]
    if "body" in data or not partial:
        body = str(data.get("body") or "")
        if len(body) > MAX_BODY:
            raise ValidationError("That message is too long to store.")
        values["body"] = body
    if "priority" in data or not partial:
        priority = str(data.get("priority") or "NORMAL").upper()
        if priority not in EMAIL_PRIORITY:
            raise ValidationError(
                "Unknown priority.",
                details={"priority": priority, "allowed": list(EMAIL_PRIORITY)},
            )
        values["priority"] = priority

    # All three on a full write, so `compose` reads a complete shape. Only the
    # ones given on a partial one, so editing a draft's subject does not
    # silently empty its cc list.
    for field in ("to", "cc", "bcc"):
        if field in data or not partial:
            values[field] = _validated_recipients(data.get(field), field)

    # A draft with no recipient is normal — that is what a draft is for. The
    # requirement belongs at the moment of sending, and on a *partial* write
    # it belongs to the row rather than to the payload: `PUT {"send": true}`
    # on a draft that already has recipients names none of its own, and
    # reading the payload refused to send a perfectly complete message.
    # `update_message` makes that check against the row it just wrote.
    if not partial and data.get("send") and not values.get("to"):
        raise ValidationError("A message needs at least one recipient before it goes.")

    # A template supplies whatever the composer left blank, and never
    # overwrites what somebody typed: a template that replaced an edited
    # subject would be a template nobody dares pick twice.
    if data.get("template"):
        filled = _rendered(_template_row(session, str(data["template"])), data.get("variables"))
        if not values.get("subject"):
            values["subject"] = filled["subject"]
        if not values.get("body"):
            values["body"] = filled["body"]

    return values


def _validated_recipients(raw: Any, field: str) -> list[dict[str, str]]:
    """`["a@b.c"]` or `[{name, email}]` → one shape, with the addresses checked.

    Validated here because a malformed address is worth refusing at the moment
    somebody can still fix it — and because the stored shape is what every
    screen reads: two accepted spellings would be two renderings of a
    recipient list.
    """
    if raw in (None, ""):
        return []
    items = raw if isinstance(raw, list) else [raw]
    if len(items) > MAX_RECIPIENTS:
        raise ValidationError(f"At most {MAX_RECIPIENTS} addresses in {field}.")

    cleaned: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        if isinstance(item, str):
            item = {"email": item}
        if not isinstance(item, dict):
            raise ValidationError(f"each entry in {field} must be an address")
        email = str(item.get("email") or "").strip().lower()
        if not _EMAIL.match(email):
            raise ValidationError(
                f"{email or '(empty)'} is not an email address.", details={"field": field}
            )
        if email in seen:
            continue
        seen.add(email)
        cleaned.append({"name": str(item.get("name") or "").strip()[:160], "email": email})
    return cleaned


def _validated_labels(raw: Any) -> list[str] | None:
    if raw in (None, [], ""):
        return None
    if not isinstance(raw, list):
        raise ValidationError("labels must be a list")
    labels = sorted({str(item).strip()[:48] for item in raw if str(item).strip()})
    if len(labels) > MAX_LABELS:
        raise ValidationError(f"A thread takes at most {MAX_LABELS} labels.")
    return labels or None


def _one_label(raw: Any) -> str:
    label = str(raw or "").strip()[:48]
    if not label:
        raise ValidationError("That action needs a label.")
    return label


def _folder(raw: Any, *, default: str) -> str:
    folder = str(raw or default).strip().upper()
    if folder not in EMAIL_FOLDER:
        raise ValidationError(
            "Unknown folder.", details={"folder": folder, "allowed": list(EMAIL_FOLDER)}
        )
    return folder


def _movable(raw: Any) -> str:
    """A folder a person may file a thread into.

    `SENT` and `OUTBOX` are the platform's own: letting somebody file an
    inbound message into `SENT` would make the folder mean nothing, and every
    count and report reading it would then be describing a fiction.
    """
    folder = _folder(raw, default="INBOX")
    if folder not in MOVABLE:
        raise ValidationError(
            f"A thread cannot be moved to {folder}.",
            details={"folder": folder, "allowed": list(MOVABLE)},
        )
    return folder
