"""Intake forms: designed here, answered anywhere, turned into records.

**A form writes through the same door a person does.** A submission becomes a
record by `record_writes.create`, so the values a form may set are exactly the
values the dataset accepts from its own edit form, coerced and validated by
the same rules, and the record is audited like any other.

**What arrived is kept, whatever happened next.** The submission row is
written first; the conversion is attempted inside a savepoint; a value the
dataset refuses marks the submission FAILED with the reason, rather than
losing what somebody took the trouble to send.

**A public form is a door to the internet.** It is closed unless published,
rate-limited per address, guarded by a signed arithmetic challenge and a
honeypot field, and an anonymous caller only ever learns that it was received.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import random
import re
import time
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.config import Config
from src.core import audit
from src.core.clock import iso, now
from src.core.errors import (
    ConflictError, ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError, ValidationError,
)
from src.core.naming import identifier, sequence_of
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.repository import get_or_404
from src.models.forms import FormSubmission, IntakeForm

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


# ── Design ──────────────────────────────────────────────────────────────


def _writable(target: str) -> dict[str, Any]:
    from src.services.explorer import resources

    resource = resources().get(target)
    if resource is None or resource.identity is None:
        raise ValidationError(f"Forms cannot create {target!r} records.", details={"field": "target"})
    return {spec.name: spec for spec in resource.editable}


def targets_catalogue() -> list[dict[str, Any]]:
    from src.services.explorer import resources

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


def _checked_settings(raw: Any, current: dict[str, Any] | None) -> dict[str, Any]:
    merged = {**DEFAULT_SETTINGS, **(current or {}), **(raw if isinstance(raw, dict) else {})}
    if merged["visibility"] not in ("PUBLIC", "INTERNAL"):
        raise ValidationError("visibility is PUBLIC or INTERNAL.", details={"field": "settings.visibility"})
    try:
        merged["rate_limit_per_hour"] = max(1, min(1000, int(merged["rate_limit_per_hour"])))
    except (TypeError, ValueError) as exc:
        raise ValidationError("The rate limit is a number per hour.",
                              details={"field": "settings.rate_limit_per_hour"}) from exc
    merged["notify_user_ids"] = [str(parse_uuid(item, field="notify_user_ids"))
                                 for item in merged.get("notify_user_ids") or []]
    merged["captcha"] = bool(merged["captcha"])
    merged["confirmation"] = str(merged.get("confirmation") or DEFAULT_SETTINGS["confirmation"])[:1000]
    merged["submit_label"] = str(merged.get("submit_label") or "Send")[:40]
    if not isinstance(merged.get("defaults"), dict):
        raise ValidationError("defaults must be an object.", details={"field": "settings.defaults"})
    return merged


def _body(row: IntakeForm, *, full: bool = True) -> dict[str, Any]:
    settings = {**DEFAULT_SETTINGS, **(row.settings or {})}
    body = {
        "id": str(row.id), "name": row.name, "slug": row.slug, "description": row.description or "",
        "target": row.target, "status": row.status, "visibility": settings["visibility"],
        "submission_count": row.submission_count, "owner": row.owner.full_name if row.owner else None,
        "public_path": f"/f/{row.slug}", "updated_at": iso(row.updated_at), "created_at": iso(row.created_at),
        "field_count": len([f for f in row.fields or [] if f.get("type") != "heading"]),
    }
    if full:
        body["fields"] = row.fields or []
        body["settings"] = settings
    return body


def listing(session, args, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    clauses = [IntakeForm.deleted_at.is_(None)]
    if args.get("status"):
        clauses.append(IntakeForm.status == str(args.get("status")).upper())
    rows = session.scalars(select(IntakeForm).where(*clauses).order_by(IntakeForm.updated_at.desc())).unique().all()
    week = now() - timedelta(days=7)
    recent = dict(session.execute(
        select(FormSubmission.form_id, func.count()).where(FormSubmission.created_at >= week)
        .group_by(FormSubmission.form_id)).all())
    failed = dict(session.execute(
        select(FormSubmission.form_id, func.count()).where(FormSubmission.status == "FAILED")
        .group_by(FormSubmission.form_id)).all())
    return {
        "items": [{**_body(row, full=False), "last_week": int(recent.get(row.id, 0)),
                   "failed": int(failed.get(row.id, 0))} for row in rows],
        "targets": targets_catalogue(),
        "field_types": list(FIELD_TYPES),
        "can_manage": principal.can(MANAGE),
    }


def _row(session, ident: Any) -> IntakeForm:
    row = get_or_404(
        session,
        IntakeForm,
        parse_uuid(ident, field="form_id"),
        "That form does not exist.",
        live=True,
    )
    return row


def entry(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    return {**_body(_row(session, ident)), "targets": targets_catalogue(),
            "can_manage": principal.can(MANAGE)}


def _slug_from(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "form"
    return slug if len(slug) >= 3 else f"{slug}-form"


def save(session, payload: dict[str, Any], *, principal, ident: Any = None) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _row(session, ident) if ident else IntakeForm(owner_id=principal.user_id, status="DRAFT",
                                                         submission_count=0)
    name = str(payload.get("name", row.name or "")).strip()
    if not name:
        raise ValidationError("Give the form a name.", details={"field": "name"})
    row.name = name[:160]
    row.description = str(payload.get("description", row.description or "")).strip() or None
    target = str(payload.get("target", row.target or "ticket"))
    if target not in TARGETS:
        raise ValidationError("Choose what the form creates.", details={"field": "target", "allowed": TARGETS})
    row.target = target
    slug = str(payload.get("slug") or row.slug or _slug_from(name)).strip().lower()
    if not SLUG.match(slug):
        raise ValidationError("The address may use lowercase letters, digits and dashes.",
                              details={"field": "slug"})
    clash = session.scalar(select(IntakeForm.id).where(IntakeForm.slug == slug, IntakeForm.id != row.id))
    if clash:
        raise ConflictError("Another form already uses that address.", details={"field": "slug"})
    row.slug = slug
    row.fields = _checked_fields(target, payload.get("fields", row.fields or []))
    row.settings = _checked_settings(payload.get("settings"), row.settings)
    status = str(payload.get("status", row.status or "DRAFT")).upper()
    if status not in STATUSES:
        raise ValidationError("Unknown status.", details={"field": "status"})
    if status == "PUBLISHED":
        _refuse_unpublishable(row)
    row.status = status
    if not ident:
        session.add(row)
    session.flush()
    audit.record(session, action="CONFIGURATION_CHANGE" if ident else "CREATE", resource_type="intake_form",
                 resource_id=row.id, resource_label=row.name, principal=principal,
                 after={"status": row.status, "fields": len(row.fields or [])},
                 message=f"saved form {row.name}")
    return entry(session, row.id, principal=principal)


def _refuse_unpublishable(row: IntakeForm) -> None:
    writable = _writable(row.target)
    mapped = {field.get("map_to") for field in row.fields or []}
    defaults = set(((row.settings or {}).get("defaults") or {}).keys())
    missing = [name for name, spec in writable.items() if spec.required and name not in mapped | defaults]
    if missing:
        raise ValidationError(
            f"Map a field to {', '.join(missing)} before publishing — the record needs it.",
            details={"field": "fields", "missing": missing},
        )


def remove(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _row(session, ident)
    row.deleted_at = now()
    row.status = "CLOSED"
    audit.record(session, action="DELETE", resource_type="intake_form", resource_id=row.id,
                 resource_label=row.name, principal=principal, message=f"removed form {row.name}")
    return {"id": str(row.id), "removed": True}


def submissions(session, ident: Any, args, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = _row(session, ident)
    page = parse_page(args, default_sort="created_at")
    clauses = [FormSubmission.form_id == row.id]
    if args.get("status"):
        clauses.append(FormSubmission.status == str(args.get("status")).upper())
    total = session.scalar(select(func.count()).select_from(FormSubmission).where(*clauses)) or 0
    rows = session.scalars(select(FormSubmission).where(*clauses).order_by(FormSubmission.created_at.desc())
                           .offset(page.offset).limit(page.page_size)).unique().all()
    counts = dict(session.execute(select(FormSubmission.status, func.count())
                                  .where(FormSubmission.form_id == row.id).group_by(FormSubmission.status)).all())
    return envelope([_submission_body(item, row) for item in rows], int(total), page,
                    counts={key: int(value) for key, value in counts.items()})


def _record_path(record_type: str | None, record_id: str | None) -> str | None:
    if not record_type or not record_id:
        return None
    from src.services.explorer import resources

    resource = resources().get(record_type)
    return f"{resource.path}/{record_id}" if resource else None


def _submission_body(item: FormSubmission, form: IntakeForm) -> dict[str, Any]:
    labels = {field["id"]: field["label"] for field in form.fields or []}
    answers = []
    for key, value in (item.data or {}).items():
        if key.startswith("_"):
            continue
        answers.append({"id": key, "label": labels.get(key, key), "value": value})
    return {
        "id": str(item.id), "reference": item.reference, "status": item.status,
        "created_at": iso(item.created_at), "record_type": item.record_type, "record_id": item.record_id,
        "record_label": item.record_label, "record_path": _record_path(item.record_type, item.record_id),
        "error": item.error or "", "submitter_email": item.submitter_email,
        "answers": answers,
    }


def retry(session, ident: Any, submission_id: Any, *, principal) -> dict[str, Any]:
    """Try a FAILED submission again, as the person pressing the button."""
    principal.require(MANAGE)
    form = _row(session, ident)
    item = session.get(FormSubmission, parse_uuid(submission_id, field="submission_id"))
    if item is None or item.form_id != form.id:
        raise NotFoundError("That submission does not exist.")
    if item.status == "CONVERTED":
        raise ConflictError("This submission already became a record.")
    _convert(session, form, item, principal=principal)
    return _submission_body(item, form)


# ── Answering ───────────────────────────────────────────────────────────


def _sign(payload: str) -> str:
    return hmac.new(Config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]


def challenge(slug: str) -> dict[str, Any]:
    a, b = random.randint(2, 9), random.randint(2, 9)
    expires = int(time.time()) + CHALLENGE_TTL
    payload = f"{slug}:{a + b}:{expires}"
    return {"question": f"What is {a} + {b}?", "token": f"{expires}.{_sign(payload)}"}


def _check_challenge(slug: str, token: Any, answer: Any) -> None:
    try:
        expires_raw, signature = str(token).split(".", 1)
        expires = int(expires_raw)
        expected = _sign(f"{slug}:{int(str(answer).strip())}:{expires}")
    except (TypeError, ValueError) as exc:
        raise ValidationError("Answer the question to show you are a person.",
                              details={"field": "captcha"}) from exc
    if expires < time.time() or not hmac.compare_digest(expected, signature):
        raise ValidationError("That answer is not right — try again.", details={"field": "captcha"})


def _live(session, slug: str, principal) -> IntakeForm:
    row = session.scalars(select(IntakeForm).where(IntakeForm.slug == str(slug).lower(),
                                                   IntakeForm.deleted_at.is_(None))).first()
    if row is None or row.status == "DRAFT" and not (principal and principal.can(MANAGE)):
        raise NotFoundError("This form does not exist.")
    settings = {**DEFAULT_SETTINGS, **(row.settings or {})}
    if settings["visibility"] == "INTERNAL" and principal is None:
        raise UnauthorizedError("Sign in to use this form.", details={"visibility": "INTERNAL"})
    return row


def public_form(session, slug: str, *, principal) -> dict[str, Any]:
    row = _live(session, slug, principal)
    settings = {**DEFAULT_SETTINGS, **(row.settings or {})}
    return {
        "name": row.name, "slug": row.slug, "description": row.description or "",
        "status": row.status, "open": row.status == "PUBLISHED",
        "fields": [{key: value for key, value in field.items() if key != "map_to"} for field in row.fields or []],
        "submit_label": settings["submit_label"], "visibility": settings["visibility"],
        "challenge": challenge(row.slug) if settings["captcha"] and principal is None else None,
        "honeypot": HONEYPOT,
    }


def _visible(field: dict[str, Any], answers: dict[str, Any]) -> bool:
    rule = field.get("visible_when")
    if not rule:
        return True
    value = answers.get(rule["field"])
    expected = rule.get("equals")
    if isinstance(value, list):
        return expected in value
    return value == expected if expected not in (None, "") else bool(value)


def _clean_answers(session, form: IntakeForm, raw: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    answers: dict[str, Any] = {}
    files: list[dict[str, Any]] = []
    problems: dict[str, str] = {}
    for field in form.fields or []:
        if field["type"] == "heading":
            continue
        if not _visible(field, answers):
            continue
        value = raw.get(field["id"])
        empty = value in (None, "", []) or (isinstance(value, dict) and not value.get("data"))
        if empty:
            if field.get("required"):
                problems[field["id"]] = f"{field['label']} is required."
            continue
        kind = field["type"]
        if kind == "email" and not EMAIL.match(str(value)):
            problems[field["id"]] = "That does not look like an email address."
        elif kind == "number":
            try:
                value = float(value)
                value = int(value) if value.is_integer() else value
            except (TypeError, ValueError):
                problems[field["id"]] = "A number is needed."
        elif kind == "rating":
            try:
                value = int(value)
                if not 1 <= value <= int(field.get("max") or 5):
                    raise ValueError
            except (TypeError, ValueError):
                problems[field["id"]] = "Choose a rating."
        elif kind == "select" and str(value) not in field.get("options", []):
            problems[field["id"]] = "Choose one of the options."
        elif kind == "multiselect":
            value = [str(item) for item in (value if isinstance(value, list) else [value])]
            if any(item not in field.get("options", []) for item in value):
                problems[field["id"]] = "Choose from the options."
        elif kind == "file":
            stored = _store_file(form, value)
            if isinstance(stored, str):
                problems[field["id"]] = stored
            else:
                files.append({"field": field["id"], **stored})
                value = stored["name"]
        elif kind in ("text", "textarea", "email", "date"):
            value = str(value)[: 5000 if kind == "textarea" else 500]
        answers[field["id"]] = value
    if problems:
        raise ValidationError("Some answers need another look.", details={"fields": problems})
    return answers, files


def _store_file(form: IntakeForm, value: Any) -> dict[str, Any] | str:
    from src.core import storage

    if not isinstance(value, dict):
        return "Attach a file."
    name = str(value.get("name") or "attachment")[:180]
    data = str(value.get("data") or "")
    if "," in data:
        data = data.split(",", 1)[1]
    try:
        blob = base64.b64decode(data, validate=True)
    except (ValueError, TypeError):
        return "The file could not be read."
    if len(blob) > MAX_FILE_BYTES:
        return f"Files may be at most {MAX_FILE_BYTES // (1024 * 1024)} MB."
    try:
        storage.refuse_unacceptable(name, len(blob))
    except ValidationError as exc:
        return exc.message
    key = storage.key_for("forms", str(form.id), hashlib.sha256(blob).hexdigest()[:24],
                          re.sub(r"[^A-Za-z0-9._-]", "_", name))
    stored = storage.for_config().put(key, blob, content_type=storage.content_type_for(name))
    return {"name": name, "key": stored.key, "size": stored.size_bytes}


def _reference(session) -> str:
    latest = session.scalar(select(func.max(FormSubmission.reference)).where(
        FormSubmission.reference.like(f"{REFERENCE_PREFIX}-%")))
    number = sequence_of(latest, prefix=REFERENCE_PREFIX) + 1
    candidate = identifier(REFERENCE_PREFIX, number, width=5)
    while session.scalar(select(FormSubmission.id).where(FormSubmission.reference == candidate)):
        number += 1
        candidate = identifier(REFERENCE_PREFIX, number, width=5)
    return candidate


def _form_principal(session, form: IntakeForm, submitter):
    """Who the record is created as: the form, on its owner's behalf.

    Not the person answering, even when signed in: an internal form is how
    somebody without `records.create` raises a ticket, which is the point of
    it. The audit line names both — the form and who answered it.
    """
    from src.core.auth import Principal
    from src.models.identity import User

    owner = session.get(User, form.owner_id) if form.owner_id else None
    label = f"{form.name} (form)" if submitter is None else f"{submitter.full_name} via {form.name}"
    return Principal(
        user_id=owner.id if owner else None, subject="", email=owner.email if owner else "",
        username=f"form:{form.slug}", full_name=label[:160], role_code="SYSTEM",
        permissions=frozenset({"records.view", "records.create"}),
    )


def _convert(session, form: IntakeForm, item: FormSubmission, *, principal) -> None:
    from src.services import record_writes

    payload = dict(((form.settings or {}).get("defaults") or {}))
    answers = item.data or {}
    for field in form.fields or []:
        target = field.get("map_to")
        if target and field["id"] in answers:
            value = answers[field["id"]]
            payload[target] = ", ".join(value) if isinstance(value, list) else value
    if form.target == "ticket":
        extras = [f"{field['label']}: {answers[field['id']]}" for field in form.fields or []
                  if not field.get("map_to") and field["id"] in answers and field["type"] != "heading"]
        if extras:
            payload["description"] = "\n".join(filter(None, [str(payload.get("description") or ""), *extras]))
        payload.setdefault("channel", "PORTAL")
    try:
        with session.begin_nested():
            created = record_writes.create(session, form.target, payload, principal=principal)
        item.status = "CONVERTED"
        item.record_type = form.target
        item.record_id = str(created.get("id"))
        item.record_label = str(created.get("subtitle") or created.get("title") or "")[:240]
        item.error = None
    except (ValidationError, ForbiddenError) as exc:
        item.status = "FAILED"
        detail = exc.details.get("fields") if isinstance(exc.details, dict) else None
        item.error = exc.message + (f" {detail}" if detail else "")
    session.flush()


def submit(session, slug: str, payload: dict[str, Any], *, principal, client: str) -> dict[str, Any]:
    form = _live(session, slug, principal)
    if form.status != "PUBLISHED":
        raise ConflictError("This form is not taking answers right now.")
    settings = {**DEFAULT_SETTINGS, **(form.settings or {})}
    client_hash = hashlib.sha256(f"{Config.SECRET_KEY}:{client}".encode()).hexdigest()
    answers_in = payload.get("answers") if isinstance(payload.get("answers"), dict) else {}

    spam = bool(str(payload.get(HONEYPOT) or answers_in.get(HONEYPOT) or "").strip())
    if principal is None:
        recent = session.scalar(select(func.count()).select_from(FormSubmission).where(
            FormSubmission.form_id == form.id, FormSubmission.client_hash == client_hash,
            FormSubmission.created_at >= now() - timedelta(hours=1))) or 0
        if recent >= settings["rate_limit_per_hour"]:
            raise RateLimitedError("Too many answers from here — try again in an hour.",
                                   details={"limit": settings["rate_limit_per_hour"]})
        if settings["captcha"] and not spam:
            _check_challenge(form.slug, payload.get("captcha_token"), payload.get("captcha_answer"))

    if spam:
        # Answer exactly as a success would, so a bot learns nothing.
        session.add(FormSubmission(form_id=form.id, reference=_reference(session), data={}, status="SPAM",
                                   client_hash=client_hash))
        session.flush()
        return {"ok": True, "message": settings["confirmation"], "reference": None}

    answers, files = _clean_answers(session, form, answers_in)
    if files:
        answers["_files"] = files
    email = next((answers[field["id"]] for field in form.fields or []
                  if field["type"] == "email" and field["id"] in answers), None)
    item = FormSubmission(form_id=form.id, reference=_reference(session), data=answers, status="FAILED",
                          submitter_id=principal.user_id if principal else None,
                          submitter_email=str(email)[:255] if email else (principal.email if principal else None),
                          client_hash=client_hash)
    session.add(item)
    session.flush()
    _convert(session, form, item, principal=_form_principal(session, form, principal))
    form.submission_count = (form.submission_count or 0) + 1

    from src.services import notifications

    for user_id in settings.get("notify_user_ids") or []:
        notifications.publish(
            session, user_id=parse_uuid(user_id, field="notify_user_ids"),
            title=f"New answer to {form.name}",
            category="SYSTEM", severity="WARNING" if item.status == "FAILED" else "INFO",
            body=item.record_label or item.error or "", link=f"/admin/forms/{form.id}?tab=submissions",
            icon="inbox", resource_type="intake_form", resource_id=str(form.id), group_key=f"form:{form.id}",
        )
    session.flush()
    body = {"ok": True, "message": settings["confirmation"], "reference": item.reference}
    if principal is not None:
        body.update({"status": item.status, "record_path": _record_path(item.record_type, item.record_id),
                     "record_label": item.record_label})
    return body
