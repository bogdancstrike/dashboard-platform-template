"""Form vocabulary, the dataset a form writes, and its fields checked."""

from __future__ import annotations

import re
from typing import Any

from src.core.errors import ValidationError

MANAGE = "forms.manage"


VIEW = "records.view"


FIELD_TYPES = ("text", "textarea", "email", "number", "select", "multiselect", "date", "file",
               "rating", "heading")


STATUSES = ("DRAFT", "PUBLISHED", "CLOSED")


TARGETS = ("ticket", "customer", "task", "project", "order", "device")


SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")


EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


MAX_FIELDS = 60


MAX_FILE_BYTES = 3 * 1024 * 1024


HONEYPOT = "website"


CHALLENGE_TTL = 2 * 60 * 60


REFERENCE_PREFIX = "SUB"


DEFAULT_SETTINGS: dict[str, Any] = {
    "visibility": "PUBLIC",
    "confirmation": "Thank you — we have received your request.",
    "notify_user_ids": [],
    "captcha": True,
    "rate_limit_per_hour": 10,
    "defaults": {},
    "submit_label": "Send",
}


def _writable(target: str) -> dict[str, Any]:
    from src.services.records.explorer import resources

    resource = resources().get(target)
    if resource is None or resource.identity is None:
        raise ValidationError(f"Forms cannot create {target!r} records.", details={"field": "target"})
    return {spec.name: spec for spec in resource.editable}


def targets_catalogue() -> list[dict[str, Any]]:
    from src.services.records.explorer import resources

    out = []
    for key in TARGETS:
        resource = resources().get(key)
        if resource is None or resource.identity is None:
            continue
        fields = []
        for spec in resource.editable:
            field = resource.fields.by_name.get(spec.name)
            if field is None or field.kind == "json":
                continue
            fields.append({"name": spec.name, "label": field.title, "kind": field.kind,
                           "required": spec.required, "choices": list(field.choices),
                           "references": resource.writability(spec.name).get("references", "")})
        out.append({"key": key, "label": resource.label, "fields": fields})
    return out


def _checked_fields(target: str, raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise ValidationError("fields must be a list.", details={"field": "fields"})
    if len(raw) > MAX_FIELDS:
        raise ValidationError(f"At most {MAX_FIELDS} fields.", details={"field": "fields"})
    checker = _FieldChecker(_writable(target))
    return [checker.check(index, item) for index, item in enumerate(raw)]


def _refuse(message: str) -> ValidationError:
    return ValidationError(message, details={"field": "fields"})


class _FieldChecker:
    """Checks a form's fields in order, remembering ids and mapped columns so
    far: an id must be unique, a column written once, and a condition may only
    look at a field above it."""

    def __init__(self, writable) -> None:
        self.writable = writable
        self.seen_ids: set[str] = set()
        self.mapped: set[str] = set()

    def check(self, index: int, item: Any) -> dict[str, Any]:
        if not isinstance(item, dict):
            raise _refuse(f"Field {index + 1} is not an object.")
        kind = str(item.get("type") or "")
        if kind not in FIELD_TYPES:
            raise _refuse(f"Field {index + 1}: unknown type {kind!r}.")
        ident = str(item.get("id") or f"f{index + 1}")
        if not re.match(r"^[A-Za-z0-9_-]{1,40}$", ident) or ident in self.seen_ids or ident == HONEYPOT:
            raise _refuse(f"Field {index + 1}: the id must be unique and simple.")
        self.seen_ids.add(ident)
        label = str(item.get("label") or "").strip()
        if not label:
            raise _refuse(f"Field {index + 1} needs a label.")
        field: dict[str, Any] = {"id": ident, "type": kind, "label": label[:200],
                                 "help": str(item.get("help") or "")[:400],
                                 "required": bool(item.get("required")) and kind != "heading",
                                 "placeholder": str(item.get("placeholder") or "")[:120]}
        if kind in ("select", "multiselect"):
            options = [str(option).strip()[:120] for option in item.get("options") or [] if str(option).strip()]
            if not options:
                raise _refuse(f"{label}: give at least one option.")
            field["options"] = options
        if kind == "rating":
            field["max"] = min(10, max(3, int(item.get("max") or 5)))
        self._mapping(field, item, kind, label)
        self._visibility(field, item, ident, label)
        return field

    def _mapping(self, field: dict[str, Any], item: dict[str, Any], kind: str, label: str) -> None:
        map_to = str(item.get("map_to") or "")
        if not map_to or kind in ("heading", "file"):
            return
        if map_to not in self.writable:
            raise _refuse(f"{label}: {map_to!r} is not a field the dataset accepts.")
        if map_to in self.mapped:
            raise _refuse(f"Two fields write {map_to!r}.")
        self.mapped.add(map_to)
        field["map_to"] = map_to

    def _visibility(self, field: dict[str, Any], item: dict[str, Any], ident: str, label: str) -> None:
        visible = item.get("visible_when")
        if not (isinstance(visible, dict) and visible.get("field")):
            return
        if str(visible["field"]) not in self.seen_ids - {ident}:
            raise _refuse(f"{label}: it can only depend on a field above it.")
        field["visible_when"] = {"field": str(visible["field"]), "equals": visible.get("equals")}
