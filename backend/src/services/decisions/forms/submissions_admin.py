"""Submissions: the list, retrying one, and converting it into a record."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core.clock import iso
from src.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from src.core.pagination import envelope, parse_page, parse_uuid
from src.models.forms import FormSubmission, IntakeForm
from src.services.decisions.forms.field_checks import MANAGE, VIEW
from src.services.decisions.forms.forms_admin import _row


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
    from src.services.records.explorer import resources

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


def _convert(session, form: IntakeForm, item: FormSubmission, *, principal) -> None:
    from src.services.records import writes as record_writes

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
