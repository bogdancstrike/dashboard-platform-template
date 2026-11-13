"""Submitting a form, and the record it creates."""

from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.config import Config
from src.core.clock import now
from src.core.errors import ConflictError, RateLimitedError
from src.core.naming import identifier, sequence_of
from src.core.pagination import parse_uuid
from src.models.forms import FormSubmission, IntakeForm
from src.services.decisions.forms.field_checks import (
    DEFAULT_SETTINGS,
    HONEYPOT,
    REFERENCE_PREFIX,
)
from src.services.decisions.forms.public_side import (
    _check_challenge,
    _clean_answers,
    _live,
)
from src.services.decisions.forms.submissions_admin import _convert, _record_path


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

    from src.services.collaboration import notifications

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
