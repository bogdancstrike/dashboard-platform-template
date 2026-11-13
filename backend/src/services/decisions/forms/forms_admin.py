"""Forms: settings, list, one form, save, remove, submissions."""

from __future__ import annotations

import re
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ConflictError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.forms import FormSubmission, IntakeForm
from src.services.decisions.forms.field_checks import (
    DEFAULT_SETTINGS,
    FIELD_TYPES,
    MANAGE,
    SLUG,
    STATUSES,
    TARGETS,
    VIEW,
    _checked_fields,
    _writable,
    targets_catalogue,
)


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
